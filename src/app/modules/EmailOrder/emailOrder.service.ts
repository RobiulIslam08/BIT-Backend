// ============================================
// BIT SOFTWARE — Business Email Order Service
// ============================================

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { EmailOrder } from './emailOrder.model';
import { Email } from '../Email/email.model';
import {
  IEmailIntake,
  IEmailOrder,
  TEmailBillingCycle,
  TSupportedCurrency,
} from './emailOrder.interface';
import { getActivePlanBySlug } from '../EmailPlan/emailPlan.service';
import {
  convertFromUSD,
  getExchangeRates,
} from '../DomainOrder/domainOrder.service';
import {
  createPayPalOrder,
  capturePayPalOrder,
  refundPayPalCapture,
  getPayPalOrderDetails,
} from '../../utils/paypal';
import { sendEmail } from '../../utils/sendEmail';
import config from '../../config';
import { WalletService } from '../Wallet/wallet.service';

const generateOrderId = async (): Promise<string> => {
  let id = '';
  let unique = false;
  while (!unique) {
    id = `EML-${Math.floor(100000 + Math.random() * 900000)}`;
    const existing = await EmailOrder.findOne({ orderId: id });
    if (!existing) unique = true;
  }
  return id;
};

const addBillingPeriod = (base: Date, cycle: TEmailBillingCycle): Date => {
  const d = new Date(base);
  if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
};

const getAdminEmail = (): string =>
  process.env.ADMIN_EMAIL?.trim() || config.smtp_user || 'admin@bitsoftwareitsolution.com';

const normalizeIntake = (intake: IEmailIntake): IEmailIntake => ({
  businessName: String(intake.businessName || '').trim(),
  country: String(intake.country || '').trim(),
  teamSize: intake.teamSize?.trim() || undefined,
  domainName: normalizeDomainName(intake.domainName),
  domainOwnership: intake.domainOwnership,
  adminFirstName: String(intake.adminFirstName || '').trim(),
  adminLastName: String(intake.adminLastName || '').trim(),
  desiredEmailLocalPart: String(intake.desiredEmailLocalPart || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, ''),
  recoveryEmail: String(intake.recoveryEmail || '').trim().toLowerCase(),
  businessAddress: intake.businessAddress?.trim() || undefined,
});

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

const normalizeDomainName = (raw: string) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeIdempotencyKey = (key?: string) => {
  const k = String(key || '').trim();
  if (k.length < 16 || k.length > 80) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'A valid idempotency key is required to process this payment.',
    );
  }
  return k;
};

const isDuplicateKey = (err: unknown, field?: string) => {
  const e = err as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    keyValue?: Record<string, unknown>;
  };
  if (e?.code !== 11000) return false;
  if (!field) return true;
  return Boolean(e?.keyPattern?.[field] || e?.keyValue?.[field]);
};

const waitForOrderSettle = async (
  id: mongoose.Types.ObjectId,
  ms = 10_000,
): Promise<IEmailOrder> => {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const row = await EmailOrder.findById(id);
    if (row?.orderStatus === 'active' && row.paymentStatus === 'paid') {
      return row.toObject() as IEmailOrder;
    }
    if (row?.orderStatus === 'failed' || row?.orderStatus === 'cancelled') {
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        row.failureReason || 'Payment failed. You were not charged twice.',
      );
    }
    await sleep(400);
  }
  const last = await EmailOrder.findById(id);
  if (last?.orderStatus === 'active') return last.toObject() as IEmailOrder;
  throw new AppError(
    httpStatus.CONFLICT,
    'Your payment is still being confirmed. Wait a few seconds and open My Account — do not pay again.',
  );
};

const assertNoExistingMailbox = async (userId: string, intake: IEmailIntake) => {
  const existing = await Email.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    domainName: intake.domainName,
    desiredEmailLocalPart: intake.desiredEmailLocalPart,
    status: { $in: ['active', 'pending'] },
  }).lean();
  if (existing) {
    throw new AppError(
      httpStatus.CONFLICT,
      `You already have ${intake.desiredEmailLocalPart}@${intake.domainName}. Open it from My Account instead of paying again.`,
    );
  }
};

const toPayPalCreateResult = (order: IEmailOrder & { _id?: unknown }) => ({
  orderId: order.orderId,
  dbOrderId: String(order._id),
  paypalOrderId: order.paypalOrderId,
  displayAmount: order.displayAmount,
  displayCurrency: order.displayCurrency,
  sellPriceUSD: order.sellPriceUSD,
  alreadyPaid: order.paymentStatus === 'paid',
});

const validateIntake = (intake: IEmailIntake) => {
  if (!intake.businessName) throw new AppError(httpStatus.BAD_REQUEST, 'Business name is required.');
  if (!intake.country) throw new AppError(httpStatus.BAD_REQUEST, 'Country is required.');
  if (!intake.domainName) throw new AppError(httpStatus.BAD_REQUEST, 'Domain name is required.');
  if (!DOMAIN_RE.test(intake.domainName)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Enter a valid domain (e.g. yourcompany.com).');
  }
  if (!intake.adminFirstName) throw new AppError(httpStatus.BAD_REQUEST, 'Admin first name is required.');
  if (!intake.adminLastName) throw new AppError(httpStatus.BAD_REQUEST, 'Admin last name is required.');
  if (!intake.desiredEmailLocalPart) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Email username is required.');
  }
  if (!LOCAL_RE.test(intake.desiredEmailLocalPart)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'Email username may only use letters, numbers, dots, hyphens, and underscores.',
    );
  }
  if (!intake.recoveryEmail) throw new AppError(httpStatus.BAD_REQUEST, 'Recovery email is required.');
  if (!EMAIL_RE.test(intake.recoveryEmail)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Enter a valid recovery email.');
  }
};

type PurchasePayload = IEmailIntake & {
  planSlug: string;
  billingCycle: TEmailBillingCycle;
  displayCurrency: TSupportedCurrency;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  userId: string;
  idempotencyKey: string;
  termsAccepted?: boolean;
};

const buildAssetFromOrder = (order: IEmailOrder, now: Date, expiresAt: Date) => ({
  userId: order.userId,
  planSlug: order.planSlug,
  planName: order.planName,
  billingCycle: order.billingCycle,
  features: order.features || [],
  businessName: order.businessName,
  country: order.country,
  teamSize: order.teamSize,
  domainName: order.domainName,
  domainOwnership: order.domainOwnership,
  adminFirstName: order.adminFirstName,
  adminLastName: order.adminLastName,
  desiredEmailLocalPart: order.desiredEmailLocalPart,
  recoveryEmail: order.recoveryEmail,
  businessAddress: order.businessAddress,
  customerPhone: order.customerPhone,
  source: 'purchase' as const,
  status: 'active' as const,
  provisioningStatus: 'pending_setup' as const,
  startsAt: now,
  expiresAt,
  amountUSD: order.sellPriceUSD,
  renewPriceUSD: order.sellPriceUSD,
  emailOrderId: (order as any)._id,
  emailPlanId: order.emailPlanId,
});

export const createPayPalOrderForEmail = async (payload: PurchasePayload) => {
  const {
    planSlug,
    billingCycle,
    displayCurrency,
    customerName,
    customerEmail,
    customerPhone,
    userId,
    idempotencyKey: rawKey,
    termsAccepted,
    ...rawIntake
  } = payload;

  if (termsAccepted !== true) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Please accept the Terms of Service to continue.');
  }
  if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
    throw new AppError(httpStatus.BAD_REQUEST, 'billingCycle must be monthly or yearly.');
  }
  if (!customerPhone?.trim() || customerPhone.trim().length < 8) {
    throw new AppError(httpStatus.BAD_REQUEST, 'A valid phone number is required.');
  }
  if (!EMAIL_RE.test(String(customerEmail || '').trim())) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Enter a valid contact email.');
  }

  const idempotencyKey = normalizeIdempotencyKey(rawKey);
  const intake = normalizeIntake(rawIntake);
  validateIntake(intake);
  await assertNoExistingMailbox(userId, intake);

  const existingByKey = await EmailOrder.findOne({
    idempotencyKey,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (existingByKey) {
    if (existingByKey.paymentStatus === 'paid' || existingByKey.orderStatus === 'active') {
      return toPayPalCreateResult(existingByKey.toObject() as IEmailOrder);
    }
    if (existingByKey.orderStatus === 'processing') {
      const settled = await waitForOrderSettle(existingByKey._id as mongoose.Types.ObjectId);
      return toPayPalCreateResult(settled);
    }
    if (existingByKey.orderStatus === 'pending_payment') {
      if (existingByKey.paypalOrderId) {
        return toPayPalCreateResult(existingByKey.toObject() as IEmailOrder);
      }
      const started = Date.now();
      while (Date.now() - started < 5000) {
        await sleep(300);
        const row = await EmailOrder.findById(existingByKey._id);
        if (row?.paypalOrderId) return toPayPalCreateResult(row.toObject() as IEmailOrder);
        if (row?.orderStatus === 'active') return toPayPalCreateResult(row.toObject() as IEmailOrder);
      }
    }
  }

  const plan = await getActivePlanBySlug(planSlug);
  const sellPriceUSD =
    billingCycle === 'monthly' ? plan.monthlyPriceUSD : plan.yearlyPriceUSD;

  if (typeof sellPriceUSD !== 'number' || sellPriceUSD <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid plan pricing.');
  }

  const { displayAmount, rate } = await convertFromUSD(sellPriceUSD, displayCurrency);
  const cycleLabel = billingCycle === 'monthly' ? '1 month' : '1 year';
  const paypalRes = await createPayPalOrder(
    sellPriceUSD.toFixed(2),
    `Business Email: ${plan.name} (${cycleLabel})`,
    'email',
    `email-${idempotencyKey}`,
  );

  const paypalOrderId = paypalRes.id;
  if (!paypalOrderId) throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to create PayPal order.');

  const orderId = await generateOrderId();

  try {
    const emailOrder = await EmailOrder.create({
      orderId,
      idempotencyKey,
      userId: new mongoose.Types.ObjectId(userId),
      planSlug: plan.slug,
      planName: plan.name,
      billingCycle,
      features: plan.features || [],
      ...intake,
      sellPriceUSD,
      displayCurrency,
      displayAmount,
      exchangeRateUsed: rate,
      paymentMethod: 'paypal',
      paymentStatus: 'pending',
      paypalOrderId,
      orderStatus: 'pending_payment',
      emailPlanId: (plan as any)._id,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: customerPhone.trim(),
    });

    return toPayPalCreateResult(emailOrder.toObject() as IEmailOrder);
  } catch (err) {
    if (isDuplicateKey(err, 'idempotencyKey')) {
      const dup = await EmailOrder.findOne({
        idempotencyKey,
        userId: new mongoose.Types.ObjectId(userId),
      });
      if (dup?.paypalOrderId) return toPayPalCreateResult(dup.toObject() as IEmailOrder);
      if (dup) {
        const settled = await waitForOrderSettle(dup._id as mongoose.Types.ObjectId);
        return toPayPalCreateResult(settled);
      }
    }
    throw err;
  }
};

export const completeEmailPurchase = async (payload: {
  paypalOrderId: string;
  userId: string;
}): Promise<IEmailOrder> => {
  const { paypalOrderId, userId } = payload;

  // Idempotent: already completed
  const alreadyActive = await EmailOrder.findOne({
    paypalOrderId,
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: 'active',
  });
  if (alreadyActive) return alreadyActive.toObject() as IEmailOrder;

  // Atomically claim pending order to prevent concurrent double-provision
  const pendingOrder = await EmailOrder.findOneAndUpdate(
    {
      paypalOrderId,
      userId: new mongoose.Types.ObjectId(userId),
      orderStatus: 'pending_payment',
      paymentStatus: 'pending',
    },
    { $set: { orderStatus: 'processing' } },
    { new: true },
  );

  if (!pendingOrder) {
    const existing = await EmailOrder.findOne({
      paypalOrderId,
      userId: new mongoose.Types.ObjectId(userId),
    });
    if (!existing) {
      throw new AppError(
        httpStatus.NOT_FOUND,
        'Pending email order not found. If you were charged, open My Account — do not pay again.',
      );
    }
    if (existing.orderStatus === 'active' && existing.paymentStatus === 'paid') {
      return existing.toObject() as IEmailOrder;
    }
    if (existing.orderStatus === 'failed' || existing.orderStatus === 'cancelled') {
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        existing.failureReason || 'This payment could not be completed. You were not charged twice.',
      );
    }
    // Another request is capturing or provisioning — wait, never capture twice.
    return waitForOrderSettle(existing._id as mongoose.Types.ObjectId);
  }

  const session = await mongoose.startSession();
  let captureId: string | null = null;

  try {
    let captureResult: any;
    try {
      captureResult = await capturePayPalOrder(paypalOrderId);
    } catch (err: any) {
      // Recover if PayPal already captured (retry after prior DB failure)
      try {
        const details = await getPayPalOrderDetails(paypalOrderId);
        if (details?.status === 'COMPLETED') {
          captureResult = details;
        } else {
          await EmailOrder.updateOne(
            { _id: pendingOrder._id },
            { $set: { orderStatus: 'pending_payment', failureReason: err.message } },
          );
          throw new AppError(httpStatus.PAYMENT_REQUIRED, `PayPal capture failed: ${err.message}`);
        }
      } catch (inner: any) {
        if (inner instanceof AppError) throw inner;
        await EmailOrder.updateOne(
          { _id: pendingOrder._id },
          { $set: { orderStatus: 'pending_payment', failureReason: err.message } },
        );
        throw new AppError(httpStatus.PAYMENT_REQUIRED, `PayPal capture failed: ${err.message}`);
      }
    }

    const captureStatus = captureResult?.status;
    if (captureStatus !== 'COMPLETED') {
      await EmailOrder.updateOne(
        { _id: pendingOrder._id },
        { $set: { orderStatus: 'pending_payment' } },
      );
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        `PayPal payment not completed. Status: ${captureStatus}`,
      );
    }

    const captureUnit =
      captureResult?.purchase_units?.[0]?.payments?.captures?.[0] ||
      captureResult?.purchase_units?.[0]?.payments?.captures?.find((c: any) => c.status === 'COMPLETED');
    captureId = captureUnit?.id ?? null;
    const capturedAmountUSD = parseFloat(captureUnit?.amount?.value ?? '0');
    const capturedCurrency = captureUnit?.amount?.currency_code ?? 'USD';

    if (
      capturedCurrency !== 'USD' ||
      Math.abs(capturedAmountUSD - pendingOrder.sellPriceUSD) > 0.01
    ) {
      if (captureId) {
        try {
          await refundPayPalCapture(captureId, capturedAmountUSD.toFixed(2), 'USD');
        } catch {
          /* ignore */
        }
      }
      await EmailOrder.updateOne(
        { _id: pendingOrder._id },
        {
          $set: {
            orderStatus: 'failed',
            paymentStatus: 'failed',
            failureReason: 'Payment amount mismatch',
          },
        },
      );
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        `Payment amount mismatch. Expected $${pendingOrder.sellPriceUSD} USD, got $${capturedAmountUSD} ${capturedCurrency}.`,
      );
    }

    session.startTransaction();

    const now = new Date();
    const expiresAt = addBillingPeriod(now, pendingOrder.billingCycle);

    await EmailOrder.updateOne(
      { _id: pendingOrder._id },
      {
        $set: {
          paymentStatus: 'paid',
          orderStatus: 'processing',
          paypalCaptureId: captureId,
          paypalTransactionId: captureUnit?.id,
          startsAt: now,
          expiresAt,
        },
      },
      { session },
    );

    let asset;
    try {
      [asset] = await Email.create(
        [buildAssetFromOrder(pendingOrder.toObject() as IEmailOrder, now, expiresAt)],
        { session },
      );
    } catch (createErr: any) {
      // Unique emailOrderId — another worker already provisioned
      if (createErr?.code === 11000) {
        await session.abortTransaction();
        const existingAsset = await Email.findOne({ emailOrderId: pendingOrder._id });
        if (existingAsset) {
          await EmailOrder.updateOne(
            { _id: pendingOrder._id },
            { $set: { orderStatus: 'active', emailAssetId: existingAsset._id, paymentStatus: 'paid' } },
          );
          const refreshed = await EmailOrder.findById(pendingOrder._id);
          return (refreshed?.toObject() || pendingOrder.toObject()) as IEmailOrder;
        }
      }
      throw createErr;
    }

    await EmailOrder.updateOne(
      { _id: pendingOrder._id },
      { $set: { orderStatus: 'active', emailAssetId: asset._id } },
      { session },
    );

    await session.commitTransaction();

    const desiredEmail = `${pendingOrder.desiredEmailLocalPart}@${pendingOrder.domainName}`;

    try {
      await sendEmail(
        pendingOrder.customerEmail,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4F46E5;">Payment received — mailbox setup started</h2>
            <p>Dear ${pendingOrder.customerName},</p>
            <p>We received payment for your <strong>${pendingOrder.planName}</strong> Business Email plan.</p>
            <p>We are preparing <strong>${desiredEmail}</strong>. Access details will appear in My Account once setup is complete.</p>
            <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Plan</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.planName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Domain</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.domainName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Billing</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.billingCycle}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Expires</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${expiresAt.toDateString()}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Amount Paid</td><td style="padding: 8px; border: 1px solid #e5e7eb;">$${pendingOrder.sellPriceUSD} USD</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Order ID</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.orderId}</td></tr>
            </table>
            <p>Manage your emails from <a href="${process.env.FRONTEND_URL}/my-account?tab=email">My Account → Email</a>.</p>
            <p>Thank you for choosing BIT Software &amp; IT Solution!</p>
          </div>
        `,
        `Payment received — Business Email "${pendingOrder.planName}" — BIT Software`,
      );
    } catch (emailErr) {
      console.error('[EmailPurchase] Customer email failed:', emailErr);
    }

    try {
      await sendEmail(
        getAdminEmail(),
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>New Business Email Purchase — Manual Setup Needed</h2>
            <p>Order <strong>${pendingOrder.orderId}</strong></p>
            <p>Customer: ${pendingOrder.customerName} (${pendingOrder.customerEmail}) · ${pendingOrder.customerPhone}</p>
            <p>Plan: ${pendingOrder.planName} (${pendingOrder.billingCycle}) — $${pendingOrder.sellPriceUSD} USD</p>
            <h3>Intake</h3>
            <ul>
              <li>Business: ${pendingOrder.businessName}</li>
              <li>Country: ${pendingOrder.country}</li>
              <li>Team size: ${pendingOrder.teamSize || '—'}</li>
              <li>Domain: ${pendingOrder.domainName} (${pendingOrder.domainOwnership || '—'})</li>
              <li>Admin: ${pendingOrder.adminFirstName} ${pendingOrder.adminLastName}</li>
              <li>Desired mailbox: ${desiredEmail}</li>
              <li>Recovery: ${pendingOrder.recoveryEmail}</li>
              <li>Address: ${pendingOrder.businessAddress || '—'}</li>
            </ul>
            <p>Open the mailbox manually, then paste credentials in Admin → Emails.</p>
          </div>
        `,
        `🛒 New Business Email Order ${pendingOrder.orderId}`,
      );
    } catch (adminEmailErr) {
      console.error('[EmailPurchase] Admin email failed:', adminEmailErr);
    }

    const refreshed = await EmailOrder.findById(pendingOrder._id);
    return (refreshed?.toObject() || pendingOrder.toObject()) as IEmailOrder;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

export const payForEmailWithWallet = async (payload: PurchasePayload): Promise<IEmailOrder> => {
  const {
    planSlug,
    billingCycle,
    displayCurrency,
    customerName,
    customerEmail,
    customerPhone,
    userId,
    idempotencyKey: rawKey,
    termsAccepted,
    ...rawIntake
  } = payload;

  if (termsAccepted !== true) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Please accept the Terms of Service to continue.');
  }
  if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
    throw new AppError(httpStatus.BAD_REQUEST, 'billingCycle must be monthly or yearly.');
  }
  if (!customerPhone?.trim() || customerPhone.trim().length < 8) {
    throw new AppError(httpStatus.BAD_REQUEST, 'A valid phone number is required.');
  }
  if (!EMAIL_RE.test(String(customerEmail || '').trim())) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Enter a valid contact email.');
  }

  const idempotencyKey = normalizeIdempotencyKey(rawKey);
  const intake = normalizeIntake(rawIntake);
  validateIntake(intake);
  await assertNoExistingMailbox(userId, intake);

  const existingByKey = await EmailOrder.findOne({
    idempotencyKey,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (existingByKey) {
    if (existingByKey.paymentStatus === 'paid' || existingByKey.orderStatus === 'active') {
      return existingByKey.toObject() as IEmailOrder;
    }
    if (existingByKey.orderStatus === 'processing') {
      return waitForOrderSettle(existingByKey._id as mongoose.Types.ObjectId);
    }
    if (
      existingByKey.paymentMethod === 'wallet' &&
      existingByKey.paymentStatus === 'pending'
    ) {
      await sleep(600);
      const again = await EmailOrder.findById(existingByKey._id);
      if (again?.paymentStatus === 'paid' || again?.orderStatus === 'active') {
        return again.toObject() as IEmailOrder;
      }
      // Stale incomplete attempt — release the key so this request can pay once.
      await EmailOrder.updateOne(
        {
          _id: existingByKey._id,
          paymentMethod: 'wallet',
          paymentStatus: 'pending',
        },
        {
          $set: {
            orderStatus: 'cancelled',
            failureReason: 'Incomplete account-balance attempt',
          },
          $unset: { idempotencyKey: 1 },
        },
      );
    }
  }

  const plan = await getActivePlanBySlug(planSlug);
  const sellPriceUSD =
    billingCycle === 'monthly' ? plan.monthlyPriceUSD : plan.yearlyPriceUSD;
  if (typeof sellPriceUSD !== 'number' || sellPriceUSD <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid plan pricing.');
  }

  const { displayAmount, rate } = await convertFromUSD(sellPriceUSD, displayCurrency);
  const orderId = await generateOrderId();
  const now = new Date();
  const expiresAt = addBillingPeriod(now, billingCycle);

  const session = await mongoose.startSession();
  let createdOrderId: mongoose.Types.ObjectId | null = null;

  try {
    await session.withTransaction(async () => {
      const [order] = await EmailOrder.create(
        [
          {
            orderId,
            idempotencyKey,
            userId: new mongoose.Types.ObjectId(userId),
            planSlug: plan.slug,
            planName: plan.name,
            billingCycle,
            features: plan.features || [],
            ...intake,
            sellPriceUSD,
            displayCurrency,
            displayAmount,
            exchangeRateUsed: rate,
            paymentMethod: 'wallet',
            paymentStatus: 'pending',
            orderStatus: 'processing',
            emailPlanId: (plan as any)._id,
            customerName: customerName.trim(),
            customerEmail: customerEmail.trim().toLowerCase(),
            customerPhone: customerPhone.trim(),
            startsAt: now,
            expiresAt,
          },
        ],
        { session },
      );

      const spend = await WalletService.spendFromWallet({
        userId,
        amountUSD: sellPriceUSD,
        reference: { kind: 'email_order', id: orderId },
        note: `Business Email: ${plan.name} (${billingCycle})`,
        session,
      });

      const [asset] = await Email.create(
        [buildAssetFromOrder(order.toObject() as IEmailOrder, now, expiresAt)],
        { session },
      );

      await EmailOrder.updateOne(
        { _id: order._id },
        {
          $set: {
            paymentStatus: 'paid',
            orderStatus: 'active',
            emailAssetId: asset._id,
            walletTransactionId: new mongoose.Types.ObjectId(spend.transactionId),
            walletPromoUsed: spend.promoUsed,
            walletAccountUsed: spend.accountUsed,
          },
        },
        { session },
      );

      createdOrderId = order._id;
    });
  } catch (err) {
    if (isDuplicateKey(err, 'idempotencyKey')) {
      const dup = await EmailOrder.findOne({
        idempotencyKey,
        userId: new mongoose.Types.ObjectId(userId),
      });
      if (dup?.paymentStatus === 'paid' || dup?.orderStatus === 'active') {
        return dup.toObject() as IEmailOrder;
      }
      if (dup) return waitForOrderSettle(dup._id as mongoose.Types.ObjectId);
    }
    throw err;
  } finally {
    session.endSession();
  }

  if (!createdOrderId) {
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to process wallet payment.');
  }

  const desiredEmail = `${intake.desiredEmailLocalPart}@${intake.domainName}`;

  try {
    await sendEmail(
      customerEmail.trim().toLowerCase(),
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4F46E5;">Payment received — mailbox setup started</h2>
          <p>Dear ${customerName.trim()},</p>
          <p>We received your wallet payment for <strong>${plan.name}</strong> Business Email.</p>
          <p>We are preparing <strong>${desiredEmail}</strong>. Access details will appear in My Account once setup is complete.</p>
          <p><strong>Order ID:</strong> ${orderId}</p>
          <p><a href="${process.env.FRONTEND_URL}/my-account?tab=email">My Account → Email</a></p>
        </div>
      `,
      `Payment received — Business Email ${plan.name} — BIT Software`,
    );
  } catch (emailErr) {
    console.error('[EmailWallet] Customer email failed:', emailErr);
  }

  try {
    await sendEmail(
      getAdminEmail(),
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>New Business Email (Wallet) — Manual Setup Needed</h2>
          <p>Order <strong>${orderId}</strong> — ${customerName} (${customerEmail})</p>
          <p>Domain: ${intake.domainName} · Mailbox: ${desiredEmail}</p>
          <p>Open mailbox manually, then paste credentials in Admin → Emails.</p>
        </div>
      `,
      `New Business Email Order ${orderId}`,
    );
  } catch (adminEmailErr) {
    console.error('[EmailWallet] Admin email failed:', adminEmailErr);
  }

  const refreshed = await EmailOrder.findById(createdOrderId).lean();
  return refreshed as IEmailOrder;
};

export const getUserEmailOrders = async (userId: string) => {
  return EmailOrder.find({
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: { $ne: 'pending_payment' },
  })
    .sort({ createdAt: -1 })
    .lean();
};

export const getEmailOrderById = async (id: string, userId?: string) => {
  const filter: Record<string, unknown> = mongoose.isValidObjectId(id)
    ? { $or: [{ _id: id }, { orderId: id }] }
    : { orderId: id };
  if (userId) filter.userId = new mongoose.Types.ObjectId(userId);

  const order = await EmailOrder.findOne(filter).lean();
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Email order not found.');
  return order;
};

export const getAllEmailOrders = async (query: Record<string, unknown>) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.orderStatus) filter.orderStatus = query.orderStatus;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.search) {
    const term = String(query.search).trim();
    filter.$or = [
      { orderId: { $regex: term, $options: 'i' } },
      { customerName: { $regex: term, $options: 'i' } },
      { customerEmail: { $regex: term, $options: 'i' } },
      { planName: { $regex: term, $options: 'i' } },
      { domainName: { $regex: term, $options: 'i' } },
      { businessName: { $regex: term, $options: 'i' } },
    ];
  }

  const [orders, total] = await Promise.all([
    EmailOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email')
      .lean(),
    EmailOrder.countDocuments(filter),
  ]);

  return {
    orders,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const updateEmailOrderStatus = async (
  id: string,
  payload: { orderStatus?: string; paymentStatus?: string; failureReason?: string },
) => {
  const order = await EmailOrder.findById(id);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Email order not found.');

  if (payload.orderStatus) order.orderStatus = payload.orderStatus as any;
  if (payload.paymentStatus) order.paymentStatus = payload.paymentStatus as any;
  if (payload.failureReason !== undefined) order.failureReason = payload.failureReason;

  await order.save();
  return order.toObject() as IEmailOrder;
};

export const getPublicExchangeRates = async () => getExchangeRates();

export const sweepAbandonedEmailCheckouts = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const result = await EmailOrder.updateMany(
    {
      orderStatus: 'pending_payment',
      paymentStatus: 'pending',
      createdAt: { $lt: cutoff },
      abandonedAt: { $exists: false },
    },
    {
      $set: {
        orderStatus: 'cancelled',
        abandonedAt: new Date(),
        failureReason: 'Abandoned checkout (auto-cancelled)',
      },
    },
  );
  return result.modifiedCount || 0;
};
