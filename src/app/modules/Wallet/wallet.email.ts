// ============================================
// BIT SOFTWARE — Wallet customer email notifications
// ============================================
// Every balance-affecting / withdrawal event emails the customer with a
// full breakdown. Failures are logged only — never throw to callers.

import { sendEmail } from '../../utils/sendEmail';
import { User } from '../User/user.model';
import { roundMoney } from '../../utils/money';
import {
  IWalletTxnReference,
  IWithdrawalDetails,
  TWithdrawalMethod,
} from './wallet.interface';

const PRODUCTION_FRONTEND = 'https://bitsoftwareanditsolution.com';

/** Customer-facing links must never point at localhost. */
const FRONTEND = () => {
  const raw = (process.env.FRONTEND_URL || PRODUCTION_FRONTEND).trim().replace(/\/$/, '');
  if (!raw || /localhost|127\.0\.0\.1/i.test(raw)) return PRODUCTION_FRONTEND;
  return raw;
};

const WALLET_URL = () => `${FRONTEND()}/my-account?tab=wallet`;

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtUSD = (n: number | undefined | null) =>
  `$${roundMoney(n || 0).toFixed(2)} USD`;

const fmtSignedUSD = (n: number) => {
  const v = roundMoney(n || 0);
  const sign = v > 0 ? '+' : '';
  return `${sign}$${v.toFixed(2)} USD`;
};

const row = (label: string, value: string) =>
  `<tr>
    <td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;width:42%;">${escapeHtml(label)}</td>
    <td style="padding:8px;border:1px solid #e5e7eb;">${value}</td>
  </tr>`;

const detailTable = (rows: string) =>
  `<table style="border-collapse:collapse;width:100%;margin:16px 0;">${rows}</table>`;

const emailShell = (title: string, color: string, inner: string) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827;">
    <h2 style="color: ${color}; margin-bottom: 8px;">${title}</h2>
    ${inner}
    <p style="margin-top:20px;">
      Manage your wallet anytime from
      <a href="${WALLET_URL()}">My Account → Wallet</a>.
    </p>
    <p>Thank you for choosing BIT Software &amp; IT Solution.</p>
  </div>`;

const balanceRows = (account: number, promo: number) =>
  row('Account Balance (withdrawable)', fmtUSD(account)) +
  row('Promotional Credit', fmtUSD(promo)) +
  row('Total Balance', fmtUSD(roundMoney((account || 0) + (promo || 0))));

const methodLabel = (method: TWithdrawalMethod) => {
  const map: Record<TWithdrawalMethod, string> = {
    bank: 'Bank Transfer',
    bkash: 'bKash',
    nagad: 'Nagad',
    paypal: 'PayPal',
  };
  return map[method] || method;
};

const formatPayoutDetails = (
  method: TWithdrawalMethod,
  details: IWithdrawalDetails = {},
): string => {
  if (method === 'bank') {
    return [
      details.bankName ? `Bank: ${escapeHtml(details.bankName)}` : null,
      details.accountName ? `Account name: ${escapeHtml(details.accountName)}` : null,
      details.accountNumber ? `Account no: ${escapeHtml(details.accountNumber)}` : null,
      details.routingNumber ? `Routing: ${escapeHtml(details.routingNumber)}` : null,
      details.branch ? `Branch: ${escapeHtml(details.branch)}` : null,
    ]
      .filter(Boolean)
      .join('<br/>');
  }
  if (method === 'bkash' || method === 'nagad') {
    return details.walletNumber
      ? `${methodLabel(method)} number: ${escapeHtml(details.walletNumber)}`
      : '—';
  }
  if (method === 'paypal') {
    return details.paypalEmail
      ? `PayPal email: ${escapeHtml(details.paypalEmail)}`
      : '—';
  }
  return '—';
};

const formatReference = (reference?: IWalletTxnReference) => {
  if (!reference?.kind && !reference?.id) return '—';
  if (reference.kind && reference.id) {
    return `${escapeHtml(reference.kind)} · ${escapeHtml(reference.id)}`;
  }
  return escapeHtml(reference.kind || reference.id || '—');
};

const getCustomer = async (userId: string) => {
  const user = await User.findById(userId).select('email name').lean();
  if (!user?.email) return null;
  return { email: user.email as string, name: (user.name as string) || 'Customer' };
};

const safeSend = async (label: string, fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (err) {
    console.error(`[WalletEmail] ${label} failed:`, err);
  }
};

// ─── Top-up ───
export const sendTopupSuccessEmail = async (params: {
  userId: string;
  grossUSD: number;
  feeUSD: number;
  netUSD: number;
  feePercent?: number;
  paypalOrderId?: string;
  paypalCaptureId?: string | null;
  balanceAfterAccount: number;
  balanceAfterPromo: number;
}) =>
  safeSend('topup', async () => {
    const user = await getCustomer(params.userId);
    if (!user) return;

    const rows =
      row('Transaction', 'Wallet Top-up') +
      row('Status', 'Completed') +
      row('Amount Paid (PayPal)', fmtUSD(params.grossUSD)) +
      row(
        'Service Fee',
        `${fmtUSD(params.feeUSD)}${
          typeof params.feePercent === 'number' ? ` (${params.feePercent}%)` : ''
        }`,
      ) +
      row('Credited to Account Balance', fmtUSD(params.netUSD)) +
      (params.paypalOrderId
        ? row('PayPal Order ID', escapeHtml(params.paypalOrderId))
        : '') +
      (params.paypalCaptureId
        ? row('PayPal Capture ID', escapeHtml(params.paypalCaptureId))
        : '') +
      balanceRows(params.balanceAfterAccount, params.balanceAfterPromo);

    await sendEmail(
      user.email,
      emailShell(
        'Wallet Top-up Successful',
        '#4F46E5',
        `
          <p>Dear ${escapeHtml(user.name)},</p>
          <p>Your wallet has been topped up successfully. Details below:</p>
          ${detailTable(rows)}
        `,
      ),
      `✅ Wallet Top-up Successful — ${fmtUSD(params.netUSD)} credited — BIT Software`,
    );
  });

// ─── Withdrawal requested ───
export const sendWithdrawalRequestedEmail = async (params: {
  userId: string;
  withdrawalId: string;
  payoutUSD: number;
  feeUSD: number;
  feePercent: number;
  totalDebitUSD: number;
  method: TWithdrawalMethod;
  details: IWithdrawalDetails;
  balanceAfterAccount: number;
  balanceAfterPromo: number;
}) =>
  safeSend('withdrawal-request', async () => {
    const user = await getCustomer(params.userId);
    if (!user) return;

    const rows =
      row('Transaction', 'Withdrawal Request') +
      row('Status', 'Pending review') +
      row('Request ID', escapeHtml(params.withdrawalId)) +
      row('Payout Amount', fmtUSD(params.payoutUSD)) +
      row('Withdrawal Fee', `${fmtUSD(params.feeUSD)} (${params.feePercent}%)`) +
      row('Total Held from Account', fmtUSD(params.totalDebitUSD)) +
      row('Payout Method', escapeHtml(methodLabel(params.method))) +
      row('Payout Details', formatPayoutDetails(params.method, params.details)) +
      balanceRows(params.balanceAfterAccount, params.balanceAfterPromo);

    await sendEmail(
      user.email,
      emailShell(
        'Withdrawal Request Received',
        '#2563EB',
        `
          <p>Dear ${escapeHtml(user.name)},</p>
          <p>We received your withdrawal request. Funds have been held from your account balance while we process the payout.</p>
          ${detailTable(rows)}
          <p>You will receive another email when the request is paid or if it is rejected.</p>
        `,
      ),
      `💸 Withdrawal Request Received — ${fmtUSD(params.payoutUSD)} — BIT Software`,
    );
  });

// ─── Mark as paid ───
export const sendWithdrawalPaidEmail = async (params: {
  userId: string;
  withdrawalId: string;
  payoutUSD: number;
  feeUSD: number;
  feePercent?: number;
  method: TWithdrawalMethod;
  details: IWithdrawalDetails;
  payoutRef?: string;
  adminNote?: string;
}) =>
  safeSend('withdrawal-paid', async () => {
    const user = await getCustomer(params.userId);
    if (!user) return;

    const rows =
      row('Transaction', 'Withdrawal Paid') +
      row('Status', 'Completed / Paid') +
      row('Request ID', escapeHtml(params.withdrawalId)) +
      row('Amount Sent to You', fmtUSD(params.payoutUSD)) +
      row(
        'Fee Deducted',
        `${fmtUSD(params.feeUSD)}${
          typeof params.feePercent === 'number' ? ` (${params.feePercent}%)` : ''
        }`,
      ) +
      row('Payout Method', escapeHtml(methodLabel(params.method))) +
      row('Payout Details', formatPayoutDetails(params.method, params.details)) +
      (params.payoutRef
        ? row('Payout / Transaction Reference', escapeHtml(params.payoutRef))
        : '') +
      (params.adminNote ? row('Admin Note', escapeHtml(params.adminNote)) : '');

    await sendEmail(
      user.email,
      emailShell(
        'Withdrawal Marked as Paid',
        '#16a34a',
        `
          <p>Dear ${escapeHtml(user.name)},</p>
          <p>Your withdrawal has been processed and marked as paid. Please allow a short time for the funds to appear in your destination account.</p>
          ${detailTable(rows)}
        `,
      ),
      `✅ Withdrawal Paid — ${fmtUSD(params.payoutUSD)} — BIT Software`,
    );
  });

// ─── Reject ───
export const sendWithdrawalRejectedEmail = async (params: {
  userId: string;
  withdrawalId: string;
  payoutUSD: number;
  feeUSD: number;
  feePercent?: number;
  refundedUSD: number;
  method: TWithdrawalMethod;
  details: IWithdrawalDetails;
  adminNote?: string;
  balanceAfterAccount: number;
  balanceAfterPromo: number;
}) =>
  safeSend('withdrawal-reject', async () => {
    const user = await getCustomer(params.userId);
    if (!user) return;

    const rows =
      row('Transaction', 'Withdrawal Rejected') +
      row('Status', 'Rejected — funds returned') +
      row('Request ID', escapeHtml(params.withdrawalId)) +
      row('Requested Payout', fmtUSD(params.payoutUSD)) +
      row(
        'Fee Previously Held',
        `${fmtUSD(params.feeUSD)}${
          typeof params.feePercent === 'number' ? ` (${params.feePercent}%)` : ''
        }`,
      ) +
      row('Amount Returned to Account', fmtUSD(params.refundedUSD)) +
      row('Payout Method', escapeHtml(methodLabel(params.method))) +
      row('Payout Details', formatPayoutDetails(params.method, params.details)) +
      (params.adminNote ? row('Reason / Admin Note', escapeHtml(params.adminNote)) : '') +
      balanceRows(params.balanceAfterAccount, params.balanceAfterPromo);

    await sendEmail(
      user.email,
      emailShell(
        'Withdrawal Request Rejected',
        '#EF4444',
        `
          <p>Dear ${escapeHtml(user.name)},</p>
          <p>Your withdrawal request was not approved. The held amount (payout + fee) has been returned to your account balance.</p>
          ${detailTable(rows)}
        `,
      ),
      `⚠️ Withdrawal Request Rejected — BIT Software`,
    );
  });

// ─── Refund to wallet ───
export const sendWalletRefundEmail = async (params: {
  userId: string;
  accountAmount: number;
  promoAmount: number;
  reference?: IWalletTxnReference;
  note?: string;
  balanceAfterAccount: number;
  balanceAfterPromo: number;
}) =>
  safeSend('refund', async () => {
    const user = await getCustomer(params.userId);
    if (!user) return;

    const total = roundMoney(
      Math.abs(params.accountAmount || 0) + Math.abs(params.promoAmount || 0),
    );

    const rows =
      row('Transaction', 'Wallet Refund') +
      row('Status', 'Completed') +
      row('Returned to Account Balance', fmtUSD(params.accountAmount)) +
      row('Returned to Promotional Credit', fmtUSD(params.promoAmount)) +
      row('Total Refunded', fmtUSD(total)) +
      row('Reference', formatReference(params.reference)) +
      (params.note ? row('Note', escapeHtml(params.note)) : '') +
      balanceRows(params.balanceAfterAccount, params.balanceAfterPromo);

    await sendEmail(
      user.email,
      emailShell(
        'Wallet Refund Received',
        '#0d9488',
        `
          <p>Dear ${escapeHtml(user.name)},</p>
          <p>A refund has been credited to your wallet. Details below:</p>
          ${detailTable(rows)}
        `,
      ),
      `↩️ Wallet Refund — ${fmtUSD(total)} — BIT Software`,
    );
  });

// ─── Correct / adjust balance ───
export const sendBalanceAdjustmentEmail = async (params: {
  userId: string;
  accountDelta: number;
  promoDelta: number;
  note?: string;
  balanceAfterAccount: number;
  balanceAfterPromo: number;
  transactionId?: string;
}) =>
  safeSend('adjustment', async () => {
    const user = await getCustomer(params.userId);
    if (!user) return;

    const rows =
      row('Transaction', 'Balance Correction') +
      row('Status', 'Completed') +
      (params.transactionId
        ? row('Transaction ID', escapeHtml(params.transactionId))
        : '') +
      row('Account Balance Change', escapeHtml(fmtSignedUSD(params.accountDelta))) +
      row('Promotional Credit Change', escapeHtml(fmtSignedUSD(params.promoDelta))) +
      (params.note ? row('Note', escapeHtml(params.note)) : '') +
      balanceRows(params.balanceAfterAccount, params.balanceAfterPromo);

    await sendEmail(
      user.email,
      emailShell(
        'Wallet Balance Updated',
        '#7c3aed',
        `
          <p>Dear ${escapeHtml(user.name)},</p>
          <p>An administrator has corrected / adjusted your wallet balances. Full details:</p>
          ${detailTable(rows)}
        `,
      ),
      `🧾 Wallet Balance Corrected — BIT Software`,
    );
  });

// ─── Grant promotional credit ───
export const sendGrantCreditEmail = async (params: {
  userId: string;
  amountUSD: number;
  note?: string;
  balanceAfterAccount: number;
  balanceAfterPromo: number;
}) =>
  safeSend('grant-credit', async () => {
    const user = await getCustomer(params.userId);
    if (!user) return;

    const rows =
      row('Transaction', 'Promotional Credit Granted') +
      row('Status', 'Completed') +
      row('Credit Amount', fmtUSD(params.amountUSD)) +
      row('Credit Type', 'Promotional (non-withdrawable)') +
      (params.note ? row('Note', escapeHtml(params.note)) : '') +
      balanceRows(params.balanceAfterAccount, params.balanceAfterPromo);

    await sendEmail(
      user.email,
      emailShell(
        'Promotional Credit Received',
        '#16a34a',
        `
          <p>Dear ${escapeHtml(user.name)},</p>
          <p>Good news! Promotional credit has been added to your wallet. You can use it for purchases on our services (it cannot be withdrawn).</p>
          ${detailTable(rows)}
        `,
      ),
      `🎁 Promotional Credit — ${fmtUSD(params.amountUSD)} — BIT Software`,
    );
  });

// ─── Send money (P2P) — sender ───
export const sendMoneySentEmail = async (params: {
  userId: string;
  amountUSD: number;
  recipientName: string;
  recipientUserCode?: string;
  note?: string;
  transferId: string;
  balanceAfterAccount: number;
  balanceAfterPromo: number;
}) =>
  safeSend('send-money-sent', async () => {
    const user = await getCustomer(params.userId);
    if (!user) return;

    const recipientLabel = params.recipientUserCode
      ? `${params.recipientName} (#${params.recipientUserCode})`
      : params.recipientName;

    const rows =
      row('Transaction', 'Send Money') +
      row('Status', 'Completed') +
      row('Amount Sent', fmtUSD(params.amountUSD)) +
      row('Recipient', escapeHtml(recipientLabel)) +
      row('Transfer ID', escapeHtml(params.transferId)) +
      (params.note ? row('Note', escapeHtml(params.note)) : '') +
      balanceRows(params.balanceAfterAccount, params.balanceAfterPromo);

    await sendEmail(
      user.email,
      emailShell(
        'Money Sent Successfully',
        '#2563EB',
        `
          <p>Dear ${escapeHtml(user.name)},</p>
          <p>You sent money from your Account Balance. The transfer was instant and had no fee.</p>
          ${detailTable(rows)}
        `,
      ),
      `💸 Money Sent — ${fmtUSD(params.amountUSD)} — BIT Software`,
    );
  });

// ─── Send money (P2P) — receiver ───
export const sendMoneyReceivedEmail = async (params: {
  userId: string;
  amountUSD: number;
  senderName: string;
  senderUserCode?: string;
  note?: string;
  transferId: string;
  balanceAfterAccount: number;
  balanceAfterPromo: number;
}) =>
  safeSend('send-money-received', async () => {
    const user = await getCustomer(params.userId);
    if (!user) return;

    const senderLabel = params.senderUserCode
      ? `${params.senderName} (#${params.senderUserCode})`
      : params.senderName;

    const rows =
      row('Transaction', 'Money Received') +
      row('Status', 'Completed') +
      row('Amount Received', fmtUSD(params.amountUSD)) +
      row('From', escapeHtml(senderLabel)) +
      row('Credited To', 'Account Balance (withdrawable)') +
      row('Transfer ID', escapeHtml(params.transferId)) +
      (params.note ? row('Note', escapeHtml(params.note)) : '') +
      balanceRows(params.balanceAfterAccount, params.balanceAfterPromo);

    await sendEmail(
      user.email,
      emailShell(
        'You Received Money',
        '#16a34a',
        `
          <p>Dear ${escapeHtml(user.name)},</p>
          <p>Another customer sent money to your Account Balance. Details below:</p>
          ${detailTable(rows)}
        `,
      ),
      `💰 Money Received — ${fmtUSD(params.amountUSD)} — BIT Software`,
    );
  });
