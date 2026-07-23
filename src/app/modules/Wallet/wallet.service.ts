// ============================================
// BIT SOFTWARE — Wallet Service (core money logic)
// ============================================
// Two balances per user, both stored in USD on the User document:
//   - accountBalance      → withdrawable (top-ups minus fee)
//   - promotionalCredit   → non-withdrawable gift/bonus
//
// Every balance change is atomic and audited:
//   1. User balance mutated with a conditional atomic $inc (prevents overspend
//      even under concurrency; $gte guard rejects debits that would go negative)
//   2. A WalletTransaction ledger row is written
// Both happen inside a MongoDB transaction so they can never drift apart.
//
// Spend order: promotional credit is always consumed FIRST, then account.

import mongoose, { ClientSession } from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { User } from '../User/user.model';
import { WalletTransaction } from './walletTransaction.model';
import { Withdrawal } from './withdrawal.model';
import {
  WalletSettings,
  WALLET_SETTINGS_KEY,
  DEFAULT_TOPUP_FEE_PERCENT,
  DEFAULT_MIN_TOPUP_USD,
} from './walletSettings.model';
import {
  IWalletTxnReference,
  TWalletTxnType,
  IWithdrawalDetails,
  TWithdrawalMethod,
} from './wallet.interface';
import {
  addMoney,
  subtractMoney,
  minMoney,
  roundMoney,
  gteMoney,
  wholeUnits,
  isWholeAmount,
} from '../../utils/money';
import {
  createPayPalOrder,
  capturePayPalOrder,
  getPayPalOrderDetails,
  refundPayPalCapture,
} from '../../utils/paypal';
import { sendEmail } from '../../utils/sendEmail';
import config from '../../config';

type IWalletTxnTypeName = TWalletTxnType;

// ─── Session helper ───
// Runs `fn` inside a transaction. If a session is passed in (nested call), it
// reuses it; otherwise it creates and manages its own.
const runInSession = async <T>(
  externalSession: ClientSession | undefined,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> => {
  if (externalSession) return fn(externalSession);

  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } finally {
    session.endSession();
  }
};

// ─── Low-level atomic balance mutation ───
// Applies signed deltas to a user's balances. Negative deltas are guarded so a
// balance can never go below zero. Returns the normalized post-balances.
const applyBalanceDelta = async (
  params: {
    userId: string | mongoose.Types.ObjectId;
    accountDelta?: number;
    promoDelta?: number;
  },
  session: ClientSession,
): Promise<{ balanceAfterAccount: number; balanceAfterPromo: number }> => {
  const accountDelta = roundMoney(params.accountDelta || 0);
  const promoDelta = roundMoney(params.promoDelta || 0);

  if (accountDelta === 0 && promoDelta === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'No balance change specified.');
  }

  const filter: Record<string, unknown> = {
    _id: params.userId,
    isDeleted: { $ne: true },
  };
  if (accountDelta < 0) filter.accountBalance = { $gte: -accountDelta };
  if (promoDelta < 0) filter.promotionalCredit = { $gte: -promoDelta };

  const inc: Record<string, number> = {};
  if (accountDelta !== 0) inc.accountBalance = accountDelta;
  if (promoDelta !== 0) inc.promotionalCredit = promoDelta;

  const updated = await User.findOneAndUpdate(
    filter,
    { $inc: inc },
    { new: true, session },
  );

  if (!updated) {
    throw new AppError(
      httpStatus.PAYMENT_REQUIRED,
      'Insufficient balance for this operation.',
    );
  }

  // Normalize to cent-exact values to prevent floating-point drift over time.
  const normAccount = roundMoney(updated.accountBalance || 0);
  const normPromo = roundMoney(updated.promotionalCredit || 0);
  if (
    normAccount !== (updated.accountBalance || 0) ||
    normPromo !== (updated.promotionalCredit || 0)
  ) {
    await User.updateOne(
      { _id: params.userId },
      { $set: { accountBalance: normAccount, promotionalCredit: normPromo } },
      { session },
    );
  }

  return { balanceAfterAccount: normAccount, balanceAfterPromo: normPromo };
};

// ─── Ledger writer ───
const recordTxn = async (
  params: {
    userId: string | mongoose.Types.ObjectId;
    type: IWalletTxnTypeName;
    status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    accountAmount?: number;
    promoAmount?: number;
    grossUSD?: number;
    feeUSD?: number;
    netUSD?: number;
    balanceAfterAccount?: number;
    balanceAfterPromo?: number;
    reference?: IWalletTxnReference;
    paypalOrderId?: string;
    paypalCaptureId?: string;
    note?: string;
    createdBy?: string | mongoose.Types.ObjectId;
  },
  session: ClientSession,
) => {
  const accountAmount = roundMoney(params.accountAmount || 0);
  const promoAmount = roundMoney(params.promoAmount || 0);
  const amount = roundMoney(Math.abs(accountAmount) + Math.abs(promoAmount));

  const [txn] = await WalletTransaction.create(
    [
      {
        userId: params.userId,
        type: params.type,
        status: params.status || 'completed',
        accountAmount,
        promoAmount,
        amount,
        grossUSD: params.grossUSD,
        feeUSD: params.feeUSD,
        netUSD: params.netUSD,
        balanceAfterAccount: params.balanceAfterAccount,
        balanceAfterPromo: params.balanceAfterPromo,
        reference: params.reference,
        paypalOrderId: params.paypalOrderId,
        paypalCaptureId: params.paypalCaptureId,
        note: params.note,
        createdBy: params.createdBy,
      },
    ],
    { session },
  );
  return txn;
};

// ============================================
// SETTINGS
// ============================================
export const getSettings = async () => {
  let settings = await WalletSettings.findOne({ key: WALLET_SETTINGS_KEY });
  if (!settings) {
    settings = await WalletSettings.create({
      key: WALLET_SETTINGS_KEY,
      topupFeePercent: DEFAULT_TOPUP_FEE_PERCENT,
      minTopupUSD: DEFAULT_MIN_TOPUP_USD,
    });
  }
  return settings;
};

export const updateSettings = async (
  payload: { topupFeePercent?: number; minTopupUSD?: number },
  adminId: string,
) => {
  const settings = await getSettings();
  if (typeof payload.topupFeePercent === 'number') {
    if (payload.topupFeePercent < 0 || payload.topupFeePercent > 100) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Fee percent must be between 0 and 100.');
    }
    settings.topupFeePercent = payload.topupFeePercent;
  }
  if (typeof payload.minTopupUSD === 'number') {
    if (payload.minTopupUSD < DEFAULT_MIN_TOPUP_USD) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Minimum top-up cannot be less than $${DEFAULT_MIN_TOPUP_USD.toFixed(2)}.`,
      );
    }
    settings.minTopupUSD = payload.minTopupUSD;
  }
  settings.updatedBy = new mongoose.Types.ObjectId(adminId);
  await settings.save();
  return settings;
};

// Compute fee + net for a given gross top-up amount, using current settings.
export const computeTopupBreakdown = async (grossUSD: number) => {
  const settings = await getSettings();
  const gross = roundMoney(grossUSD);
  const feeUSD = roundMoney((gross * settings.topupFeePercent) / 100);
  const netUSD = subtractMoney(gross, feeUSD);
  return {
    grossUSD: gross,
    feeUSD,
    netUSD,
    feePercent: settings.topupFeePercent,
    minTopupUSD: settings.minTopupUSD,
  };
};

// ============================================
// READ HELPERS
// ============================================
export const getWalletSummary = async (userId: string) => {
  const user = await User.findById(userId).select(
    'accountBalance promotionalCredit',
  );
  if (!user) throw new AppError(httpStatus.NOT_FOUND, 'User not found.');

  const accountBalance = roundMoney(user.accountBalance || 0);
  const promotionalCredit = roundMoney(user.promotionalCredit || 0);
  const settings = await getSettings();

  return {
    accountBalance,
    promotionalCredit,
    totalBalance: addMoney(accountBalance, promotionalCredit),
    withdrawableWholeUSD: wholeUnits(accountBalance), // only whole units are withdrawable
    currency: 'USD',
    feePercent: settings.topupFeePercent,
    minTopupUSD: settings.minTopupUSD,
  };
};

export const getMyTransactions = async (
  userId: string,
  query: Record<string, unknown> = {},
) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {
    userId: new mongoose.Types.ObjectId(userId),
  };
  if (query.type) filter.type = query.type;

  const [items, total] = await Promise.all([
    WalletTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    WalletTransaction.countDocuments(filter),
  ]);

  return {
    items,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

// ============================================
// SPEND / REFUND (used by checkout flows)
// ============================================
/**
 * Spend `amountUSD` from a user's wallet — promotional credit first, then
 * account balance. Throws PAYMENT_REQUIRED if the combined balance is short.
 * Pass an existing `session` to include this in a larger transaction.
 *
 * The promo/account split is computed inside a single Mongo update pipeline so
 * concurrent spends cannot false-fail when total balance is still sufficient.
 */
export const spendFromWallet = async (params: {
  userId: string;
  amountUSD: number;
  reference?: IWalletTxnReference;
  note?: string;
  session?: ClientSession;
}): Promise<{ promoUsed: number; accountUsed: number; transactionId: string }> => {
  const amount = roundMoney(params.amountUSD);
  if (!(amount > 0)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid amount.');
  }

  return runInSession(params.session, async (session) => {
    // Return the pre-image so we can derive the promo-first split that the
    // pipeline applied atomically at write time.
    const before = await User.findOneAndUpdate(
      {
        _id: params.userId,
        isDeleted: { $ne: true },
        $expr: {
          $gte: [
            {
              $add: [
                { $ifNull: ['$accountBalance', 0] },
                { $ifNull: ['$promotionalCredit', 0] },
              ],
            },
            amount,
          ],
        },
      },
      [
        {
          $set: {
            promotionalCredit: {
              $subtract: [
                { $ifNull: ['$promotionalCredit', 0] },
                { $min: [{ $ifNull: ['$promotionalCredit', 0] }, amount] },
              ],
            },
            accountBalance: {
              $subtract: [
                { $ifNull: ['$accountBalance', 0] },
                {
                  $subtract: [
                    amount,
                    { $min: [{ $ifNull: ['$promotionalCredit', 0] }, amount] },
                  ],
                },
              ],
            },
          },
        },
      ],
      { new: false, session },
    );

    if (!before) {
      const user = await User.findById(params.userId).session(session);
      if (!user || user.isDeleted) {
        throw new AppError(httpStatus.NOT_FOUND, 'User not found.');
      }
      const total = addMoney(
        roundMoney(user.accountBalance || 0),
        roundMoney(user.promotionalCredit || 0),
      );
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        `Insufficient wallet balance. Available $${total.toFixed(2)}, required $${amount.toFixed(2)}.`,
      );
    }

    const promoBefore = roundMoney(before.promotionalCredit || 0);
    const accountBefore = roundMoney(before.accountBalance || 0);
    const promoUsed = minMoney(promoBefore, amount);
    const accountUsed = subtractMoney(amount, promoUsed);

    const balanceAfterPromo = roundMoney(subtractMoney(promoBefore, promoUsed));
    const balanceAfterAccount = roundMoney(subtractMoney(accountBefore, accountUsed));

    // Normalize floats written by the pipeline to cent-exact values.
    await User.updateOne(
      { _id: params.userId },
      { $set: { accountBalance: balanceAfterAccount, promotionalCredit: balanceAfterPromo } },
      { session },
    );

    const txn = await recordTxn(
      {
        userId: before._id,
        type: 'purchase',
        status: 'completed',
        accountAmount: -accountUsed,
        promoAmount: -promoUsed,
        balanceAfterAccount,
        balanceAfterPromo,
        reference: params.reference,
        note: params.note,
      },
      session,
    );

    return {
      promoUsed,
      accountUsed,
      transactionId: txn._id.toString(),
    };
  });
};

/**
 * Return previously spent funds to the wallet (e.g. service fulfillment failed).
 * Credits back exactly what was taken from each balance.
 */
export const refundToWallet = async (params: {
  userId: string;
  accountAmount: number; // amount to return to account balance
  promoAmount: number; // amount to return to promotional credit
  reference?: IWalletTxnReference;
  note?: string;
  session?: ClientSession;
}): Promise<void> => {
  const accountAmount = roundMoney(params.accountAmount || 0);
  const promoAmount = roundMoney(params.promoAmount || 0);
  if (accountAmount === 0 && promoAmount === 0) return;

  await runInSession(params.session, async (session) => {
    const balances = await applyBalanceDelta(
      { userId: params.userId, accountDelta: accountAmount, promoDelta: promoAmount },
      session,
    );
    await recordTxn(
      {
        userId: params.userId,
        type: 'refund',
        status: 'completed',
        accountAmount,
        promoAmount,
        balanceAfterAccount: balances.balanceAfterAccount,
        balanceAfterPromo: balances.balanceAfterPromo,
        reference: params.reference,
        note: params.note,
      },
      session,
    );
  });
};

// ============================================
// TOP-UP (PayPal)
// ============================================
/**
 * Step 1: Create a PayPal order for a top-up and a pending ledger row.
 * The customer pays the full gross amount (which lands entirely in our PayPal
 * account); the fee is retained as revenue and only `net` is credited later.
 */
export const createTopupPayPalOrder = async (params: {
  userId: string;
  amountUSD: number;
}) => {
  const gross = roundMoney(params.amountUSD);
  const settings = await getSettings();

  if (!(gross > 0)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Top-up amount must be greater than zero.');
  }
  if (gross < settings.minTopupUSD) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Minimum top-up is $${settings.minTopupUSD.toFixed(2)}.`,
    );
  }

  const feeUSD = roundMoney((gross * settings.topupFeePercent) / 100);
  const netUSD = subtractMoney(gross, feeUSD);
  if (!(netUSD > 0)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'Top-up amount is too small after the fee. Please enter a larger amount.',
    );
  }

  // Ledger row FIRST so we never leave an orphan PayPal order without a matching txn.
  const pendingTxn = await runInSession(undefined, async (session) => {
    return recordTxn(
      {
        userId: params.userId,
        type: 'topup',
        status: 'pending',
        accountAmount: 0,
        promoAmount: 0,
        grossUSD: gross,
        feeUSD,
        netUSD,
        reference: { kind: 'paypal_topup' },
        note: 'Creating PayPal order.',
      },
      session,
    );
  });

  let paypalOrderId: string;
  try {
    const paypalRes = await createPayPalOrder(
      gross.toFixed(2),
      `Wallet Top-up ($${netUSD.toFixed(2)} credit after $${feeUSD.toFixed(2)} fee)`,
      'wallet',
    );
    paypalOrderId = paypalRes?.id;
    if (!paypalOrderId) {
      throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to create PayPal order.');
    }
  } catch (err) {
    await WalletTransaction.updateOne(
      { _id: pendingTxn._id },
      { $set: { status: 'failed', note: 'PayPal order creation failed.' } },
    );
    throw err;
  }

  await WalletTransaction.updateOne(
    { _id: pendingTxn._id },
    {
      $set: {
        paypalOrderId,
        reference: { kind: 'paypal_topup', id: paypalOrderId },
        note: 'Awaiting PayPal payment.',
      },
    },
  );

  return {
    paypalOrderId,
    grossUSD: gross,
    feeUSD,
    netUSD,
    feePercent: settings.topupFeePercent,
  };
};

/**
 * Credit a captured top-up. Must run only while the txn is still `processing`.
 * Credit + finalize are one Mongo transaction so a lost race rolls the credit back.
 */
const creditCapturedTopup = async (params: {
  txnId: mongoose.Types.ObjectId;
  userId: string;
  netUSD: number;
  captureId: string | null;
}) => {
  const netUSD = roundMoney(params.netUSD);
  return runInSession(undefined, async (session) => {
    const balances = await applyBalanceDelta(
      { userId: params.userId, accountDelta: netUSD },
      session,
    );
    const finalized = await WalletTransaction.findOneAndUpdate(
      { _id: params.txnId, status: 'processing' },
      {
        $set: {
          status: 'completed',
          accountAmount: netUSD,
          amount: netUSD,
          balanceAfterAccount: balances.balanceAfterAccount,
          balanceAfterPromo: balances.balanceAfterPromo,
          paypalCaptureId: params.captureId || undefined,
          note: 'Top-up completed.',
        },
      },
      { session, new: true },
    );
    if (!finalized) {
      // Another worker finished (or status changed) — abort to undo this credit.
      throw new AppError(httpStatus.CONFLICT, 'Top-up was already finalized.');
    }
    return balances;
  });
};

const extractCaptureInfo = (captureResult: any) => {
  const captureUnit =
    captureResult?.purchase_units?.[0]?.payments?.captures?.[0] ||
    captureResult?.purchase_units?.[0]?.payments?.captures?.find(
      (c: any) => c.status === 'COMPLETED',
    );
  return {
    captureId: (captureUnit?.id as string | undefined) ?? null,
    capturedAmountUSD: parseFloat(captureUnit?.amount?.value ?? '0'),
    capturedCurrency: (captureUnit?.amount?.currency_code as string | undefined) ?? 'USD',
  };
};

/**
 * Step 2: Capture the PayPal payment server-side and credit the net amount.
 * Safe to retry: `processing` top-ups resume credit after a verified capture.
 */
export const completeTopup = async (params: {
  userId: string;
  paypalOrderId: string;
}) => {
  const { userId, paypalOrderId } = params;

  // Atomic claim: pending → processing so concurrent completes cannot double-credit.
  let pendingTxn = await WalletTransaction.findOneAndUpdate(
    {
      userId: new mongoose.Types.ObjectId(userId),
      paypalOrderId,
      type: 'topup',
      status: 'pending',
    },
    { $set: { status: 'processing' } },
    { new: true },
  );

  if (!pendingTxn) {
    const existing = await WalletTransaction.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      paypalOrderId,
      type: 'topup',
    });
    if (existing?.status === 'completed') {
      const summary = await getWalletSummary(userId);
      return { alreadyProcessed: true, netUSD: existing.netUSD, summary };
    }
    if (existing?.status === 'processing') {
      // Resume after a prior crash (capture may already be done).
      pendingTxn = existing;
    } else {
      throw new AppError(httpStatus.NOT_FOUND, 'Top-up record not found.');
    }
  }

  const gross = roundMoney(pendingTxn.grossUSD || 0);
  const netUSD = roundMoney(pendingTxn.netUSD || 0);

  // Capture (server-side). If already captured (retry after partial failure), recover.
  let captureResult: any;
  try {
    const details = await getPayPalOrderDetails(paypalOrderId);
    if (details?.status === 'COMPLETED') {
      captureResult = details;
    } else {
      captureResult = await capturePayPalOrder(paypalOrderId);
    }
  } catch (err: any) {
    try {
      const details = await getPayPalOrderDetails(paypalOrderId);
      if (details?.status === 'COMPLETED') {
        captureResult = details;
      } else {
        // Release claim so the customer can retry (payment not taken yet).
        await WalletTransaction.updateOne(
          { _id: pendingTxn._id, status: 'processing' },
          { $set: { status: 'pending', note: `Capture failed: ${err.message}` } },
        );
        throw new AppError(httpStatus.PAYMENT_REQUIRED, `PayPal capture failed: ${err.message}`);
      }
    } catch (inner: any) {
      if (inner instanceof AppError) throw inner;
      await WalletTransaction.updateOne(
        { _id: pendingTxn._id, status: 'processing' },
        { $set: { status: 'pending', note: `Capture failed: ${err.message}` } },
      );
      throw new AppError(httpStatus.PAYMENT_REQUIRED, `PayPal capture failed: ${err.message}`);
    }
  }

  if (captureResult?.status !== 'COMPLETED') {
    await WalletTransaction.updateOne(
      { _id: pendingTxn._id, status: 'processing' },
      { $set: { status: 'pending', note: `PayPal status: ${captureResult?.status}` } },
    );
    throw new AppError(
      httpStatus.PAYMENT_REQUIRED,
      `PayPal payment not completed. Status: ${captureResult?.status}`,
    );
  }

  const { captureId, capturedAmountUSD, capturedCurrency } = extractCaptureInfo(captureResult);

  if (capturedCurrency !== 'USD' || Math.abs(capturedAmountUSD - gross) > 0.01) {
    if (captureId) {
      try {
        await refundPayPalCapture(captureId, capturedAmountUSD.toFixed(2), capturedCurrency);
      } catch (refundErr) {
        console.error('[Wallet] Top-up mismatch refund FAILED — MANUAL ACTION REQUIRED:', refundErr);
      }
    }
    await WalletTransaction.updateOne(
      { _id: pendingTxn._id },
      {
        $set: {
          status: 'failed',
          paypalCaptureId: captureId || undefined,
          note: `Amount mismatch. Expected $${gross}, captured $${capturedAmountUSD} ${capturedCurrency}.`,
        },
      },
    );
    throw new AppError(
      httpStatus.PAYMENT_REQUIRED,
      `Payment amount mismatch. Expected $${gross} USD, got $${capturedAmountUSD} ${capturedCurrency}.`,
    );
  }

  // Credit net to account balance + finalize ledger row atomically.
  // On failure leave status=`processing` so the customer can retry completeTopup.
  let summaryBalances: { balanceAfterAccount: number; balanceAfterPromo: number };
  try {
    summaryBalances = await creditCapturedTopup({
      txnId: pendingTxn._id as mongoose.Types.ObjectId,
      userId,
      netUSD,
      captureId,
    });
  } catch (creditErr: any) {
    if (creditErr instanceof AppError && creditErr.statusCode === httpStatus.CONFLICT) {
      const existing = await WalletTransaction.findById(pendingTxn._id);
      if (existing?.status === 'completed') {
        const summary = await getWalletSummary(userId);
        return { alreadyProcessed: true, netUSD: existing.netUSD, summary };
      }
    }
    console.error('[Wallet] Top-up captured but credit failed — retryable:', creditErr);
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Payment was captured but wallet credit is still pending. Please tap Complete again or refresh — your money is safe.',
    );
  }

  // Confirmation email (non-critical).
  try {
    const user = await User.findById(userId).select('email name');
    if (user?.email) {
      await sendEmail(
        user.email,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4F46E5;">Wallet Top-up Successful</h2>
            <p>Dear ${user.name || 'Customer'},</p>
            <p>Your wallet has been topped up successfully.</p>
            <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
              <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Paid</td><td style="padding:8px;border:1px solid #e5e7eb;">$${gross.toFixed(2)} USD</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Fee</td><td style="padding:8px;border:1px solid #e5e7eb;">$${roundMoney(pendingTxn.feeUSD || 0).toFixed(2)} USD</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Credited</td><td style="padding:8px;border:1px solid #e5e7eb;">$${netUSD.toFixed(2)} USD</td></tr>
              <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">New Balance</td><td style="padding:8px;border:1px solid #e5e7eb;">$${summaryBalances.balanceAfterAccount.toFixed(2)} USD</td></tr>
            </table>
            <p>Manage your wallet from <a href="${process.env.FRONTEND_URL}/my-account?tab=wallet">My Account → Wallet</a>.</p>
            <p>Thank you for choosing BIT Software & IT Solution!</p>
          </div>
        `,
        '✅ Wallet Top-up Successful — BIT Software',
      );
    }
  } catch (emailErr) {
    console.error('[Wallet] Top-up email failed:', emailErr);
  }

  return {
    alreadyProcessed: false,
    netUSD,
    summary: await getWalletSummary(userId),
  };
};

// ============================================
// WITHDRAWALS (customer)
// ============================================
export const requestWithdrawal = async (params: {
  userId: string;
  amountUSD: number;
  method: TWithdrawalMethod;
  details: IWithdrawalDetails;
}) => {
  const amount = roundMoney(params.amountUSD);

  // Only whole USD units can be withdrawn (fractional cents always stay).
  if (!isWholeAmount(amount)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'Withdrawal amount must be a whole number (fractional cents cannot be withdrawn).',
    );
  }

  const user = await User.findById(params.userId).select('accountBalance');
  if (!user) throw new AppError(httpStatus.NOT_FOUND, 'User not found.');

  const account = roundMoney(user.accountBalance || 0);
  const maxWithdrawable = wholeUnits(account);
  if (amount > maxWithdrawable) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `You can withdraw at most $${maxWithdrawable} (fractional cents are not withdrawable).`,
    );
  }

  validateWithdrawalDetails(params.method, params.details);

  const withdrawal = await runInSession(undefined, async (session) => {
    // Hold the funds — debit account balance now.
    const balances = await applyBalanceDelta(
      { userId: params.userId, accountDelta: -amount },
      session,
    );

    const [created] = await Withdrawal.create(
      [
        {
          userId: new mongoose.Types.ObjectId(params.userId),
          amountUSD: amount,
          method: params.method,
          details: params.details,
          status: 'pending',
        },
      ],
      { session },
    );

    const txn = await recordTxn(
      {
        userId: params.userId,
        type: 'withdrawal',
        status: 'pending',
        accountAmount: -amount,
        balanceAfterAccount: balances.balanceAfterAccount,
        balanceAfterPromo: balances.balanceAfterPromo,
        reference: { kind: 'withdrawal', id: created._id.toString() },
        note: `Withdrawal request via ${params.method}.`,
      },
      session,
    );

    created.walletTransactionId = txn._id;
    await created.save({ session });

    return created;
  });

  // Notify admin (non-critical).
  try {
    const adminEmail = process.env.ADMIN_EMAIL?.trim() || config.smtp_user;
    if (adminEmail) {
      await sendEmail(
        adminEmail,
        `
          <div style="font-family: Arial, sans-serif;">
            <h3>New Withdrawal Request</h3>
            <p>Amount: <strong>$${amount} USD</strong></p>
            <p>Method: ${params.method}</p>
            <p>Review it in the admin dashboard → Withdrawals.</p>
          </div>
        `,
        `💸 New Withdrawal Request — $${amount} USD`,
      );
    }
  } catch (err) {
    console.error('[Wallet] Withdrawal admin email failed:', err);
  }

  return withdrawal;
};

const validateWithdrawalDetails = (
  method: TWithdrawalMethod,
  details: IWithdrawalDetails,
) => {
  const d = details || {};
  if (method === 'bank') {
    if (!d.accountName || !d.accountNumber || !d.bankName) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        'Bank withdrawals require bank name, account name and account number.',
      );
    }
  } else if (method === 'bkash' || method === 'nagad') {
    if (!d.walletNumber) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `${method} withdrawals require a wallet number.`,
      );
    }
  } else if (method === 'paypal') {
    if (!d.paypalEmail) {
      throw new AppError(httpStatus.BAD_REQUEST, 'PayPal withdrawals require a PayPal email.');
    }
  }
};

export const getMyWithdrawals = async (
  userId: string,
  query: Record<string, unknown> = {},
) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter = { userId: new mongoose.Types.ObjectId(userId) };
  const [items, total] = await Promise.all([
    Withdrawal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Withdrawal.countDocuments(filter),
  ]);

  return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

// ============================================
// ADMIN
// ============================================
/**
 * Grant promotional credit to one user, several users, or ALL active users.
 */
export const grantCredit = async (params: {
  target?: 'all';
  userId?: string;
  userIds?: string[];
  amountUSD: number;
  note?: string;
  adminId: string;
}) => {
  const amount = roundMoney(params.amountUSD);
  if (!(amount > 0)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Grant amount must be greater than zero.');
  }

  let userIds: string[] = [];
  if (params.target === 'all') {
    const users = await User.find({ isDeleted: { $ne: true }, role: 'user' }).select('_id');
    userIds = users.map((u) => u._id.toString());
  } else if (Array.isArray(params.userIds) && params.userIds.length > 0) {
    userIds = params.userIds;
  } else if (params.userId) {
    userIds = [params.userId];
  }

  if (userIds.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'No recipients specified.');
  }

  let granted = 0;
  for (const uid of userIds) {
    try {
      await runInSession(undefined, async (session) => {
        const balances = await applyBalanceDelta(
          { userId: uid, promoDelta: amount },
          session,
        );
        await recordTxn(
          {
            userId: uid,
            type: 'bonus_credit',
            status: 'completed',
            promoAmount: amount,
            balanceAfterAccount: balances.balanceAfterAccount,
            balanceAfterPromo: balances.balanceAfterPromo,
            reference: { kind: 'admin' },
            note: params.note || 'Promotional credit granted.',
            createdBy: params.adminId,
          },
          session,
        );
      });
      granted += 1;
    } catch (err) {
      console.error(`[Wallet] grantCredit failed for user ${uid}:`, err);
    }
  }

  return { granted, amountUSD: amount, recipients: userIds.length };
};

/**
 * Manual admin balance correction (signed deltas). Can adjust either balance.
 */
export const adjustBalance = async (params: {
  userId: string;
  accountDelta?: number;
  promoDelta?: number;
  note?: string;
  adminId: string;
}) => {
  const accountDelta = roundMoney(params.accountDelta || 0);
  const promoDelta = roundMoney(params.promoDelta || 0);
  if (accountDelta === 0 && promoDelta === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Provide a non-zero adjustment.');
  }

  return runInSession(undefined, async (session) => {
    const balances = await applyBalanceDelta(
      { userId: params.userId, accountDelta, promoDelta },
      session,
    );
    const txn = await recordTxn(
      {
        userId: params.userId,
        type: 'adjustment',
        status: 'completed',
        accountAmount: accountDelta,
        promoAmount: promoDelta,
        balanceAfterAccount: balances.balanceAfterAccount,
        balanceAfterPromo: balances.balanceAfterPromo,
        reference: { kind: 'admin' },
        note: params.note || 'Manual adjustment.',
        createdBy: params.adminId,
      },
      session,
    );
    return { balances, transactionId: txn._id.toString() };
  });
};

export const listWithdrawals = async (query: Record<string, unknown> = {}) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;

  const [items, total] = await Promise.all([
    Withdrawal.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email userCode')
      .lean(),
    Withdrawal.countDocuments(filter),
  ]);

  return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

/**
 * Admin resolves a pending withdrawal.
 *  - complete: money has been sent externally → mark completed (funds already held)
 *  - reject:   return the held funds to the customer's account balance
 *
 * Status change + refund (on reject) happen in ONE Mongo transaction so a
 * failed refund never leaves the withdrawal stuck as rejected without credit.
 */
export const processWithdrawal = async (params: {
  withdrawalId: string;
  action: 'complete' | 'reject';
  payoutRef?: string;
  adminNote?: string;
  adminId: string;
}) => {
  const withdrawal = await runInSession(undefined, async (session) => {
    const claimed = await Withdrawal.findOneAndUpdate(
      { _id: params.withdrawalId, status: 'pending' },
      {
        $set: {
          status: params.action === 'complete' ? 'completed' : 'rejected',
          payoutRef: params.payoutRef,
          adminNote: params.adminNote,
          processedBy: new mongoose.Types.ObjectId(params.adminId),
          processedAt: new Date(),
        },
      },
      { new: true, session },
    );

    if (!claimed) {
      const existing = await Withdrawal.findById(params.withdrawalId).session(session);
      if (!existing) throw new AppError(httpStatus.NOT_FOUND, 'Withdrawal request not found.');
      throw new AppError(httpStatus.BAD_REQUEST, 'This withdrawal has already been processed.');
    }

    if (params.action === 'complete') {
      if (claimed.walletTransactionId) {
        await WalletTransaction.updateOne(
          { _id: claimed.walletTransactionId },
          { $set: { status: 'completed', note: 'Withdrawal paid out.' } },
          { session },
        );
      }
    } else {
      // Reject → return the held funds in the same transaction as the status change.
      const balances = await applyBalanceDelta(
        { userId: claimed.userId.toString(), accountDelta: claimed.amountUSD },
        session,
      );
      await recordTxn(
        {
          userId: claimed.userId.toString(),
          type: 'withdrawal_reversal',
          status: 'completed',
          accountAmount: claimed.amountUSD,
          balanceAfterAccount: balances.balanceAfterAccount,
          balanceAfterPromo: balances.balanceAfterPromo,
          reference: { kind: 'withdrawal', id: claimed._id.toString() },
          note: params.adminNote || 'Withdrawal rejected — funds returned.',
          createdBy: params.adminId,
        },
        session,
      );
      if (claimed.walletTransactionId) {
        await WalletTransaction.updateOne(
          { _id: claimed.walletTransactionId },
          { $set: { status: 'cancelled', note: 'Withdrawal rejected.' } },
          { session },
        );
      }
    }

    return claimed;
  });

  if (params.action === 'reject') {
    // Notify customer of rejection + refund (non-critical).
    try {
      const user = await User.findById(withdrawal.userId).select('email name');
      if (user?.email) {
        await sendEmail(
          user.email,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #EF4444;">Withdrawal Request Rejected</h2>
              <p>Dear ${user.name || 'Customer'},</p>
              <p>Your withdrawal request of <strong>$${withdrawal.amountUSD} USD</strong> was not approved${params.adminNote ? `: ${params.adminNote}` : '.'}</p>
              <p>The amount has been returned to your account balance.</p>
            </div>
          `,
          '⚠️ Withdrawal Request Rejected — BIT Software',
        );
      }
    } catch (err) {
      console.error('[Wallet] Withdrawal rejection email failed:', err);
    }
  }

  return Withdrawal.findById(withdrawal._id).lean();
};

export const getUserTransactions = async (
  userId: string,
  query: Record<string, unknown> = {},
) => {
  return getMyTransactions(userId, query);
};

export const WalletService = {
  getSettings,
  updateSettings,
  computeTopupBreakdown,
  getWalletSummary,
  getMyTransactions,
  spendFromWallet,
  refundToWallet,
  createTopupPayPalOrder,
  completeTopup,
  requestWithdrawal,
  getMyWithdrawals,
  grantCredit,
  adjustBalance,
  listWithdrawals,
  processWithdrawal,
  getUserTransactions,
};
