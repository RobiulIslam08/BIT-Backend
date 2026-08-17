// ============================================
// BIT SOFTWARE — Tabby Business Order Service
// ============================================

import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { TabbyOrder } from './tabbyOrder.model';
import { TabbyOrderFile } from './tabbyOrderFile.model';
import {
  ITabbyOrder,
  ITabbyOrderFileMeta,
  TTabbyFileKey,
} from './tabbyOrder.interface';
import {
  getPayPalOrderDetails,
  capturePayPalOrder,
  createPayPalOrder,
  refundPayPalCapture,
} from '../../utils/paypal';
import AppError from '../../errors/AppError';
import { sendEmail } from '../../utils/sendEmail';
import config from '../../config';
import { WalletService } from '../Wallet/wallet.service';
import { roundMoney } from '../../utils/money';

export const TABBY_PRICE_SAR = 500;
const SAR_TO_USD_RATE = 3.75;
const TABBY_AMOUNT_USD = roundMoney(TABBY_PRICE_SAR / SAR_TO_USD_RATE);

export const TABBY_FILE_KEYS: TTabbyFileKey[] = [
  'crCopy',
  'nationalAddressPdf',
  'vatCertificate',
  'ibanCertificate',
  'ownerIdCopy',
];

const ALLOWED_FILTER_KEYS = ['paymentStatus', 'orderStatus', 'paymentMethod', 'refundStatus'] as const;

type UploadedFile = {
  key: TTabbyFileKey;
  originalName: string;
  mimeType: string;
  size: number;
  data: string;
};

const sanitizeString = (value: unknown, max = 500): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value.replace(/\$[a-zA-Z]+/g, '').trim().substring(0, max);
};

const toBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return false;
};

/** KSA weekend is Friday + Saturday. */
const addWorkingDays = (from: Date, days: number): Date => {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 5 && day !== 6) added += 1;
  }
  return result;
};

const generateUniqueOrderId = async (): Promise<string> => {
  for (let i = 0; i < 20; i += 1) {
    const orderId = Math.floor(100000 + Math.random() * 900000).toString();
    const existing = await TabbyOrder.findOne({ orderId }).lean();
    if (!existing) return orderId;
  }
  throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Could not generate a unique order ID.');
};

const notifyAdmin = async (subject: string, body: string): Promise<void> => {
  try {
    const adminEmail = config.smtp_user;
    if (adminEmail) {
      await sendEmail(
        adminEmail,
        `<div style="font-family:sans-serif;max-width:640px;margin:auto;padding:16px;">${body}</div>`,
        subject,
      );
    }
  } catch {
    console.error('[Tabby] Failed to send admin notification:', subject);
  }
};

const brandFooter = `
  <hr style="border:0;border-top:1px solid #edf2f7;margin:24px 0;" />
  <p style="color:#a0aec0;font-size:12px;text-align:center;margin:0;">
    Thank you,<br/><strong>BIT Software &amp; IT Solution Team</strong>
  </p>
`;

const notifyCustomerOrder = async (order: ITabbyOrder & { orderId?: string }): Promise<void> => {
  try {
    const methodLabel = order.paymentMethod === 'paypal' ? 'PayPal' : 'Account Balance';
    const orderIdLabel = order.orderId ? `#${order.orderId}` : '';
    const promised = order.promisedBy
      ? new Date(order.promisedBy).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'within 3 working days';

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e2e8f0;border-radius:8px;">
        <h2 style="color:#0d9488;margin-top:0;">Tabby order confirmed</h2>
        <p>Dear ${order.ownerName || 'Customer'},</p>
        <p>Thank you for choosing <strong>BIT Software &amp; IT Solution</strong>. Your Tabby Business Account setup order has been received and paid.</p>
        <div style="background:#f0fdfa;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #0d9488;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;">
            <tr><td style="color:#718096;width:160px;">Order ID</td><td style="font-weight:bold;">${orderIdLabel}</td></tr>
            <tr><td style="color:#718096;">Company</td><td style="font-weight:bold;">${order.legalCompanyName}</td></tr>
            <tr><td style="color:#718096;">CR Number</td><td style="font-weight:bold;">${order.crNumber}</td></tr>
            <tr><td style="color:#718096;">Amount</td><td style="font-weight:bold;">${order.amountSAR} SAR</td></tr>
            <tr><td style="color:#718096;">Payment</td><td style="font-weight:bold;">${methodLabel} — Paid</td></tr>
          </table>
        </div>
        <p><strong>Activation:</strong> your Tabby Business account setup will be completed within <strong>3 working days</strong> (by ${promised}).</p>
        <p>If work has not started, you may request a refund from My Account. After Tabby activation succeeds, the fee is generally non-refundable.</p>
        ${brandFooter}
      </div>
    `;
    await sendEmail(order.email, html, `Tabby order confirmed ${orderIdLabel} — BIT Software`);
  } catch (err) {
    console.error('[Tabby] Customer confirmation email failed:', order.email, err);
  }
};

const notifyCustomerRefund = async (
  order: ITabbyOrder,
  kind: 'requested' | 'processed' | 'rejected',
): Promise<void> => {
  try {
    const orderIdLabel = order.orderId ? `#${order.orderId}` : '';
    const titles = {
      requested: 'Refund request received',
      processed: 'Refund processed',
      rejected: 'Refund request update',
    };
    const bodies = {
      requested: 'We received your refund request. Our team will review it shortly.',
      processed: 'Your Tabby setup fee has been refunded to the original payment method (PayPal or wallet). Processing time depends on PayPal and banks.',
      rejected: `Your refund request was not approved.${order.refundRejectedReason ? ` Reason: ${order.refundRejectedReason}` : ''}`,
    };
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #e2e8f0;border-radius:8px;">
        <h2 style="color:#0d9488;margin-top:0;">${titles[kind]} ${orderIdLabel}</h2>
        <p>Dear ${order.ownerName || 'Customer'},</p>
        <p>${bodies[kind]}</p>
        ${brandFooter}
      </div>
    `;
    await sendEmail(order.email, html, `${titles[kind]} ${orderIdLabel} — BIT Software`);
  } catch (err) {
    console.error('[Tabby] Refund email failed:', order.email, err);
  }
};

const attachFileMeta = async (order: any) => {
  if (!order) return order;
  const files = await TabbyOrderFile.find({ orderId: order._id })
    .select('key originalName mimeType size')
    .lean();
  const obj = typeof order.toObject === 'function' ? order.toObject() : { ...order };
  obj.files = files as ITabbyOrderFileMeta[];
  return obj;
};

const parseAndValidatePayload = (raw: Record<string, unknown>, userId: string) => {
  const legalCompanyName = sanitizeString(raw.legalCompanyName, 200);
  const ownerName = sanitizeString(raw.ownerName, 200);
  const email = sanitizeString(raw.email, 254)?.toLowerCase();
  const phone = sanitizeString(raw.phone, 30);
  const crNumber = sanitizeString(raw.crNumber, 20);
  const city = sanitizeString(raw.city, 100);
  const nationalAddressCode = sanitizeString(raw.nationalAddressCode, 20);
  const businessActivity = sanitizeString(raw.businessActivity, 200) || 'General business';
  const ownerNationalId = sanitizeString(raw.ownerNationalId, 20);
  const iban = (typeof raw.iban === 'string' ? raw.iban : '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/\$[a-zA-Z]+/g, '')
    .substring(0, 24);
  const bankName = sanitizeString(raw.bankName, 120) || 'As per IBAN letter';
  const ownerRoleRaw = sanitizeString(raw.ownerRole, 40);
  const ownerRole = ownerRoleRaw && ['owner', 'authorized_signatory'].includes(ownerRoleRaw)
    ? ownerRoleRaw
    : 'owner';
  const integrationRaw = sanitizeString(raw.integrationType, 20);
  const integrationType = integrationRaw && ['online', 'in_store', 'both'].includes(integrationRaw)
    ? integrationRaw
    : 'online';
  const vatRegistered = toBool(raw.vatRegistered);
  const termsAccepted = toBool(raw.termsAccepted);

  if (!legalCompanyName) throw new AppError(httpStatus.BAD_REQUEST, 'Legal company name is required.');
  if (!ownerName) throw new AppError(httpStatus.BAD_REQUEST, 'Your name is required.');
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new AppError(httpStatus.BAD_REQUEST, 'A valid email is required.');
  if (!phone) throw new AppError(httpStatus.BAD_REQUEST, 'Phone number is required.');
  if (!crNumber) throw new AppError(httpStatus.BAD_REQUEST, 'CR number is required.');
  if (!city) throw new AppError(httpStatus.BAD_REQUEST, 'City is required.');
  if (!nationalAddressCode) throw new AppError(httpStatus.BAD_REQUEST, 'National Address code is required.');
  if (!ownerNationalId) throw new AppError(httpStatus.BAD_REQUEST, 'National ID / Iqama number is required.');
  if (!iban || !/^SA[0-9]{22}$/.test(iban)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'A valid Saudi IBAN is required (SA followed by 22 digits).');
  }
  if (!termsAccepted) throw new AppError(httpStatus.BAD_REQUEST, 'You must accept the Terms of Service and refund policy.');

  const vatNumber = sanitizeString(raw.vatNumber, 20);
  if (vatRegistered && !vatNumber) {
    throw new AppError(httpStatus.BAD_REQUEST, 'VAT number is required when the business is VAT registered.');
  }

  const website = sanitizeString(raw.website, 500);

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'You must be logged in to place this order.');
  }

  return {
    userId: new mongoose.Types.ObjectId(userId),
    legalCompanyName,
    tradeName: sanitizeString(raw.tradeName, 200),
    crNumber,
    crIssueDate: sanitizeString(raw.crIssueDate, 30),
    crExpiryDate: sanitizeString(raw.crExpiryDate, 30),
    vatRegistered,
    vatNumber: vatRegistered ? vatNumber : undefined,
    city,
    nationalAddressCode,
    businessActivity,
    ownerName,
    ownerRole: ownerRole as ITabbyOrder['ownerRole'],
    ownerNationalId,
    email,
    phone,
    whatsapp: sanitizeString(raw.whatsapp, 30),
    website,
    storeLocation: sanitizeString(raw.storeLocation, 500),
    integrationType: integrationType as ITabbyOrder['integrationType'],
    iban,
    bankName,
    amountSAR: TABBY_PRICE_SAR,
    amountUSD: TABBY_AMOUNT_USD,
    termsAccepted: true,
  };
};

const MAX_FILE_BYTES = 4 * 1024 * 1024;

const saveFiles = async (orderMongoId: mongoose.Types.ObjectId, files: UploadedFile[], session?: mongoose.ClientSession) => {
  if (!files.length) return;
  for (const f of files) {
    await TabbyOrderFile.findOneAndUpdate(
      { orderId: orderMongoId, key: f.key },
      {
        $set: {
          originalName: f.originalName,
          mimeType: f.mimeType,
          size: f.size,
          data: f.data,
        },
      },
      { upsert: true, new: true, session: session || undefined },
    );
  }
};

const saveMissingFiles = async (orderMongoId: mongoose.Types.ObjectId, files: UploadedFile[]) => {
  if (!files.length) return;
  const have = await TabbyOrderFile.find({ orderId: orderMongoId }).select('key').lean();
  const present = new Set(have.map((f) => f.key));
  const missing = files.filter((f) => !present.has(f.key));
  if (missing.length) await saveFiles(orderMongoId, missing);
};

const createPayPalOrderForCheckout = async () => {
  const amountUSD = TABBY_AMOUNT_USD.toFixed(2);
  const paypalOrder = await createPayPalOrder(
    amountUSD,
    'BIT Software — Tabby Business Account Setup',
    'tabby',
  );
  if (!paypalOrder?.id) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to create PayPal order. Please try again.');
  }
  return { paypalOrderId: paypalOrder.id, amountUSD, amountSAR: TABBY_PRICE_SAR, status: paypalOrder.status };
};

const captureAndVerifyPayPal = async (
  paypalOrderIdRaw: string,
  userId: string,
): Promise<
  | { existingOrder: InstanceType<typeof TabbyOrder> }
  | {
      paypalOrderId: string;
      paypalCaptureId: string;
      paypalTransactionId: string;
      payerName?: string;
      payerEmail?: string;
    }
> => {
  if (!paypalOrderIdRaw || typeof paypalOrderIdRaw !== 'string') {
    throw new AppError(httpStatus.BAD_REQUEST, 'PayPal Order ID is required.');
  }
  const paypalOrderId = paypalOrderIdRaw.replace(/[^A-Za-z0-9\-]/g, '');
  if (paypalOrderId !== paypalOrderIdRaw) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid PayPal Order ID format.');
  }

  const existing = await TabbyOrder.findOne({ paypalOrderId });
  if (existing) {
    if (String(existing.userId) !== String(userId)) {
      throw new AppError(httpStatus.CONFLICT, 'This PayPal transaction has already been processed.');
    }
    return { existingOrder: existing };
  }

  let paypalOrder: any;
  try {
    paypalOrder = await capturePayPalOrder(paypalOrderId);
  } catch {
    try {
      paypalOrder = await getPayPalOrderDetails(paypalOrderId);
      if (paypalOrder.status !== 'COMPLETED') throw new Error('Order not completed');
    } catch {
      throw new AppError(
        httpStatus.BAD_GATEWAY,
        'Unable to verify or capture payment with PayPal. Please contact support.',
      );
    }
  }

  if (paypalOrder.status !== 'COMPLETED') {
    throw new AppError(
      httpStatus.PAYMENT_REQUIRED,
      `Payment not completed. Current status: ${paypalOrder.status}.`,
    );
  }

  const captureDetails = paypalOrder.purchase_units?.[0]?.payments?.captures?.[0];
  if (!captureDetails) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Payment capture details not found.');
  }

  const captureStatus = String(captureDetails.status || '').toUpperCase();
  if (captureStatus && captureStatus !== 'COMPLETED' && captureStatus !== 'PENDING') {
    throw new AppError(
      httpStatus.PAYMENT_REQUIRED,
      `Payment capture was not completed. Current status: ${captureDetails.status}.`,
    );
  }

  const expectedUSD = TABBY_AMOUNT_USD;
  const paidUSD = parseFloat(captureDetails.amount.value);
  if (paidUSD < expectedUSD - 0.05) {
    try {
      await refundPayPalCapture(
        captureDetails.id,
        paidUSD.toFixed(2),
        'USD',
        'Tabby setup fee mismatch — automatic refund.',
      );
    } catch {
      await notifyAdmin(
        'Tabby payment amount mismatch — refund failed',
        `PayPal ${paypalOrderId} captured $${paidUSD.toFixed(2)} (expected $${expectedUSD.toFixed(2)}). Automatic refund failed. Refund manually.`,
      );
      throw new AppError(
        httpStatus.BAD_REQUEST,
        'Payment amount does not match the Tabby service fee. Please contact support.',
      );
    }
    await notifyAdmin(
      'Tabby payment amount mismatch — refunded',
      `PayPal ${paypalOrderId} captured $${paidUSD.toFixed(2)} (expected $${expectedUSD.toFixed(2)}). Automatic refund issued.`,
    );
    throw new AppError(httpStatus.BAD_REQUEST, 'Payment amount does not match the Tabby service fee. The charge was refunded.');
  }

  return {
    paypalOrderId,
    paypalCaptureId: captureDetails.id as string,
    paypalTransactionId: captureDetails.id as string,
    payerName: `${paypalOrder.payer?.name?.given_name || ''} ${paypalOrder.payer?.name?.surname || ''}`.trim() || undefined,
    payerEmail: paypalOrder.payer?.email_address as string | undefined,
  };
};

const submitPaypalOrder = async (
  raw: Record<string, unknown>,
  userId: string,
  files: UploadedFile[],
) => {
  const payload = parseAndValidatePayload(raw, userId);

  const paypalOrderIdRaw = String(raw.paypalOrderId || '');
  const existingByPaypal = await TabbyOrder.findOne({
    paypalOrderId: paypalOrderIdRaw.replace(/[^A-Za-z0-9\-]/g, ''),
  });
  if (existingByPaypal) {
    if (String(existingByPaypal.userId) !== String(userId)) {
      throw new AppError(httpStatus.CONFLICT, 'This PayPal transaction has already been processed.');
    }
    try {
      await saveMissingFiles(existingByPaypal._id as mongoose.Types.ObjectId, files);
    } catch (err) {
      console.error('[Tabby] Retry file save failed for existing PayPal order', existingByPaypal.orderId, err);
    }
    return attachFileMeta(existingByPaypal);
  }

  const paypal = await captureAndVerifyPayPal(paypalOrderIdRaw, userId);
  if ('existingOrder' in paypal) {
    try {
      await saveMissingFiles(paypal.existingOrder._id as mongoose.Types.ObjectId, files);
    } catch (err) {
      console.error('[Tabby] File save failed for existing PayPal order', paypal.existingOrder.orderId, err);
    }
    return attachFileMeta(paypal.existingOrder);
  }

  const capture = paypal;
  const orderId = await generateUniqueOrderId();
  const promisedBy = addWorkingDays(new Date(), 3);

  let saved: any;
  try {
    saved = await TabbyOrder.create({
      ...payload,
      ...capture,
      orderId,
      promisedBy,
      paymentMethod: 'paypal',
      paymentStatus: 'paid',
      orderStatus: 'pending_review',
      refundStatus: 'none',
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      const dup = await TabbyOrder.findOne({ paypalOrderId: capture.paypalOrderId });
      if (dup && String(dup.userId) === String(userId)) {
        try {
          await saveMissingFiles(dup._id as mongoose.Types.ObjectId, files);
        } catch (fileErr) {
          console.error('[Tabby] Duplicate-key file save failed', dup.orderId, fileErr);
        }
        return attachFileMeta(dup);
      }
    }
    throw err;
  }

  try {
    await saveFiles(saved._id as mongoose.Types.ObjectId, files);
  } catch (err) {
    console.error('[Tabby] File save failed after PayPal capture', saved.orderId, err);
    await notifyAdmin(
      `Tabby documents failed after payment #${saved.orderId}`,
      `<p>Payment was captured but documents did not save. Ask the customer to retry from My Account or re-submit the same PayPal payment.</p>
       <p><b>Company:</b> ${saved.legalCompanyName}<br/><b>Email:</b> ${saved.email}</p>`,
    );
  }

  await notifyAdmin(
    'New Tabby Business order — action required',
    `<h3>New Tabby order #${orderId}</h3>
     <p><b>Company:</b> ${saved.legalCompanyName}<br/>
     <b>CR:</b> ${saved.crNumber}<br/>
     <b>Amount:</b> ${TABBY_PRICE_SAR} SAR (PayPal)<br/>
     <b>Customer:</b> ${saved.ownerName} — ${saved.email}<br/>
     <b>SLA:</b> complete within 3 working days</p>`,
  );
  await notifyCustomerOrder(saved);

  return attachFileMeta(saved);
};

const submitWalletOrder = async (
  raw: Record<string, unknown>,
  userId: string,
  files: UploadedFile[],
) => {
  const payload = parseAndValidatePayload(raw, userId);

  const recent = await TabbyOrder.findOne({
    userId: payload.userId,
    paymentMethod: 'wallet',
    paymentStatus: 'paid',
    crNumber: payload.crNumber,
    createdAt: { $gte: new Date(Date.now() - 45_000) },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (recent) return attachFileMeta(recent);

  const orderId = await generateUniqueOrderId();
  const promisedBy = addWorkingDays(new Date(), 3);

  const session = await mongoose.startSession();
  let saved: any = null;
  try {
    await session.withTransaction(async () => {
      const spend = await WalletService.spendFromWallet({
        userId,
        amountUSD: TABBY_AMOUNT_USD,
        reference: { kind: 'tabby_order', id: orderId },
        note: `Tabby Business Account Setup: ${payload.legalCompanyName}`,
        session,
      });
      const [order] = await TabbyOrder.create(
        [
          {
            ...payload,
            orderId,
            promisedBy,
            paymentMethod: 'wallet',
            paymentStatus: 'paid',
            orderStatus: 'pending_review',
            refundStatus: 'none',
            walletTransactionId: new mongoose.Types.ObjectId(spend.transactionId),
            walletPromoUsed: spend.promoUsed,
            walletAccountUsed: spend.accountUsed,
          },
        ],
        { session },
      );
      saved = order;
      await saveFiles(order._id as mongoose.Types.ObjectId, files, session);
    });
  } finally {
    session.endSession();
  }

  if (!saved) {
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to process wallet payment.');
  }

  await notifyAdmin(
    'New Tabby Business order (wallet) — action required',
    `<p><b>Company:</b> ${saved.legalCompanyName}<br/><b>Amount:</b> ${TABBY_PRICE_SAR} SAR (wallet)<br/><b>Order ID:</b> #${saved.orderId}</p>`,
  );
  await notifyCustomerOrder(saved);
  return attachFileMeta(saved);
};

const findOwnedOrder = async (userId: string, id: string) => {
  if (mongoose.Types.ObjectId.isValid(id) && String(id).length === 24) {
    return TabbyOrder.findOne({ _id: id, userId });
  }
  if (/^\d{6}$/.test(id)) {
    return TabbyOrder.findOne({ orderId: id, userId });
  }
  throw new AppError(httpStatus.BAD_REQUEST, 'Invalid order ID.');
};

const getMyOrders = async (userId: string) => {
  const orders = await TabbyOrder.find({ userId })
    .sort({ createdAt: -1 })
    .select('-paypalCaptureId -paypalTransactionId')
    .lean();
  const ids = orders.map((o) => o._id);
  const files = await TabbyOrderFile.find({ orderId: { $in: ids } })
    .select('orderId key originalName mimeType size')
    .lean();
  const byOrder = new Map<string, ITabbyOrderFileMeta[]>();
  for (const f of files) {
    const key = String(f.orderId);
    const list = byOrder.get(key) || [];
    list.push({ _id: f._id, key: f.key, originalName: f.originalName, mimeType: f.mimeType, size: f.size });
    byOrder.set(key, list);
  }
  return orders.map((o) => ({ ...o, files: byOrder.get(String(o._id)) || [] }));
};

const getMyOrderById = async (userId: string, id: string) => {
  const order = await findOwnedOrder(userId, id);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');
  const leanSafe = await TabbyOrder.findById(order._id).select('-paypalCaptureId -paypalTransactionId');
  return attachFileMeta(leanSafe);
};

const getAllOrders = async (filters: Record<string, unknown> = {}) => {
  const page = Math.max(1, parseInt(String(filters.page || 1), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(filters.limit || 20), 10)));
  const query: Record<string, unknown> = {};

  for (const key of ALLOWED_FILTER_KEYS) {
    const val = filters[key];
    if (val && typeof val === 'string') query[key] = sanitizeString(val);
  }

  const search = sanitizeString(filters.search, 80);
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { legalCompanyName: rx },
      { tradeName: rx },
      { email: rx },
      { ownerName: rx },
      { crNumber: rx },
      { orderId: rx },
      { phone: rx },
    ];
  }

  const skip = (page - 1) * limit;
  const [total, orders, statsAgg] = await Promise.all([
    TabbyOrder.countDocuments(query),
    TabbyOrder.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-paypalCaptureId -paypalTransactionId')
      .lean(),
    TabbyOrder.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending_review: { $sum: { $cond: [{ $eq: ['$orderStatus', 'pending_review'] }, 1, 0] } },
          in_progress: { $sum: { $cond: [{ $eq: ['$orderStatus', 'in_progress'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$orderStatus', 'completed'] }, 1, 0] } },
          refund_requested: { $sum: { $cond: [{ $eq: ['$refundStatus', 'requested'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const ids = orders.map((o) => o._id);
  const files = await TabbyOrderFile.find({ orderId: { $in: ids } })
    .select('orderId key originalName mimeType size')
    .lean();
  const byOrder = new Map<string, ITabbyOrderFileMeta[]>();
  for (const f of files) {
    const key = String(f.orderId);
    const list = byOrder.get(key) || [];
    list.push({ _id: f._id, key: f.key, originalName: f.originalName, mimeType: f.mimeType, size: f.size });
    byOrder.set(key, list);
  }

  const stats = statsAgg[0] || {
    total: 0,
    pending_review: 0,
    in_progress: 0,
    completed: 0,
    refund_requested: 0,
  };
  delete stats._id;

  return {
    orders: orders.map((o) => ({ ...o, files: byOrder.get(String(o._id)) || [] })),
    meta: { total, page, limit, totalPage: Math.ceil(total / limit) || 1 },
    stats,
  };
};

const updateOrder = async (id: string, updateData: Record<string, unknown>) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid order ID.');
  }

  const allowed = [
    'orderStatus',
    'adminNotes',
    'tabbyMerchantId',
    'customerVisibleNotes',
  ] as const;
  const safe: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in updateData)) continue;
    if (key === 'orderStatus') {
      const val = String(updateData.orderStatus || '');
      if (!['pending_review', 'in_progress', 'completed', 'cancelled'].includes(val)) {
        throw new AppError(httpStatus.BAD_REQUEST, 'Invalid order status.');
      }
      safe.orderStatus = val;
      continue;
    }
    const val = sanitizeString(updateData[key], key === 'adminNotes' || key === 'customerVisibleNotes' ? 2000 : 80);
    safe[key] = val || '';
  }

  if (Object.keys(safe).length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'No valid fields to update.');
  }

  const order = await TabbyOrder.findByIdAndUpdate(id, { $set: safe }, { new: true, runValidators: true });
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');
  return attachFileMeta(order);
};

const requestRefund = async (userId: string, id: string, reasonRaw: unknown) => {
  const reason = sanitizeString(reasonRaw, 1000);
  if (!reason || reason.length < 8) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Please describe why you need a refund (at least 8 characters).');
  }

  const order = await findOwnedOrder(userId, id);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');

  if (order.paymentStatus !== 'paid') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Only paid orders can be refunded.');
  }
  if (order.orderStatus === 'completed') {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'This Tabby account has already been activated. Contact support if Tabby rejected the merchant application.',
    );
  }
  if (order.refundStatus === 'requested') {
    throw new AppError(httpStatus.CONFLICT, 'A refund request is already pending review.');
  }
  if (order.refundStatus === 'processed') {
    throw new AppError(httpStatus.BAD_REQUEST, 'This order has already been refunded.');
  }

  order.refundStatus = 'requested';
  order.refundReason = reason;
  order.refundRequestedAt = new Date();
  await order.save();

  await notifyAdmin(
    `Tabby refund requested #${order.orderId}`,
    `<p>Customer ${order.ownerName} (${order.email}) requested a refund for Tabby order #${order.orderId}.</p><p><b>Reason:</b> ${reason}</p>`,
  );
  await notifyCustomerRefund(order, 'requested');
  return attachFileMeta(order);
};

const processRefund = async (
  id: string,
  action: 'approve' | 'reject',
  adminNote?: unknown,
) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid order ID.');
  }
  const order = await TabbyOrder.findById(id);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');

  if (action === 'reject') {
    if (order.refundStatus === 'processed' || order.paymentStatus === 'refunded') {
      throw new AppError(httpStatus.BAD_REQUEST, 'This order has already been refunded.');
    }
    const note = sanitizeString(adminNote, 1000);
    order.refundStatus = 'rejected';
    order.refundRejectedReason = note || 'Refund request declined.';
    await order.save();
    await notifyCustomerRefund(order, 'rejected');
    return attachFileMeta(order);
  }

  if (order.paymentStatus === 'refunded' || order.refundStatus === 'processed') {
    throw new AppError(httpStatus.BAD_REQUEST, 'This order has already been refunded.');
  }
  if (order.paymentStatus !== 'paid') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Only paid orders can be refunded.');
  }

  if (order.paymentMethod === 'paypal') {
    const captureId = order.paypalCaptureId || order.paypalTransactionId;
    if (!captureId) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Missing PayPal capture ID. Refund this order manually.');
    }
    const refund = await refundPayPalCapture(
      captureId,
      TABBY_AMOUNT_USD.toFixed(2),
      'USD',
      'Tabby Business Account Setup refund — BIT Software & IT Solution',
    );
    order.paypalRefundId = refund?.id;
  } else if (order.paymentMethod === 'wallet') {
    await WalletService.refundToWallet({
      userId: String(order.userId),
      accountAmount: order.walletAccountUsed || 0,
      promoAmount: order.walletPromoUsed || 0,
      reference: { kind: 'tabby_order', id: order.orderId },
      note: `Refund: Tabby Business Account Setup #${order.orderId}`,
    });
  }

  order.paymentStatus = 'refunded';
  order.refundStatus = 'processed';
  order.orderStatus = 'cancelled';
  order.refundedAt = new Date();
  if (sanitizeString(adminNote, 1000)) {
    order.adminNotes = [order.adminNotes, sanitizeString(adminNote, 1000)].filter(Boolean).join('\n');
  }
  await order.save();
  await notifyCustomerRefund(order, 'processed');
  return attachFileMeta(order);
};

const getFileForDownload = async (params: {
  orderId: string;
  fileId: string;
  userId: string;
  role: string;
}) => {
  if (!mongoose.Types.ObjectId.isValid(params.fileId)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid file ID.');
  }

  const file = await TabbyOrderFile.findById(params.fileId);
  if (!file) throw new AppError(httpStatus.NOT_FOUND, 'File not found.');

  const order = await TabbyOrder.findById(file.orderId).select('userId orderId');
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');

  const idMatches = String(order._id) === params.orderId || order.orderId === params.orderId;
  if (!idMatches) {
    throw new AppError(httpStatus.NOT_FOUND, 'File does not belong to this order.');
  }

  const isOwner = String(order.userId) === String(params.userId);
  const isAdmin = params.role === 'admin';
  if (!isOwner && !isAdmin) {
    throw new AppError(httpStatus.FORBIDDEN, 'You are not allowed to download this file.');
  }

  return file;
};

const uploadOrderFile = async (params: {
  orderId: string;
  userId: string;
  role: string;
  key: string;
  file: UploadedFile;
}) => {
  if (!TABBY_FILE_KEYS.includes(params.key as TTabbyFileKey)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid document type.');
  }
  if (!params.file?.data) {
    throw new AppError(httpStatus.BAD_REQUEST, 'A file is required.');
  }
  if (params.file.size > MAX_FILE_BYTES) {
    throw new AppError(httpStatus.BAD_REQUEST, 'File is too large. Please upload a photo of the document instead.');
  }

  const order = await findOwnedOrAdminOrder(params.orderId, params.userId, params.role);
  if (order.paymentStatus === 'refunded' || order.orderStatus === 'cancelled') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Documents cannot be added to a cancelled or refunded order.');
  }

  await saveFiles(order._id as mongoose.Types.ObjectId, [
    { ...params.file, key: params.key as TTabbyFileKey },
  ]);
  const fresh = await TabbyOrder.findById(order._id);
  return attachFileMeta(fresh);
};

const findOwnedOrAdminOrder = async (id: string, userId: string, role: string) => {
  const isAdmin = role === 'admin';
  if (mongoose.Types.ObjectId.isValid(id) && String(id).length === 24) {
    const order = await TabbyOrder.findById(id);
    if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');
    if (!isAdmin && String(order.userId) !== String(userId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You are not allowed to update this order.');
    }
    return order;
  }
  if (/^\d{6}$/.test(id)) {
    const order = await TabbyOrder.findOne({ orderId: id });
    if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');
    if (!isAdmin && String(order.userId) !== String(userId)) {
      throw new AppError(httpStatus.FORBIDDEN, 'You are not allowed to update this order.');
    }
    return order;
  }
  throw new AppError(httpStatus.BAD_REQUEST, 'Invalid order ID.');
};

const deleteOrder = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid order ID.');
  }
  const order = await TabbyOrder.findByIdAndDelete(id);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');
  await TabbyOrderFile.deleteMany({ orderId: order._id });
  return { deleted: true, orderId: order.orderId };
};

export const TabbyOrderServices = {
  TABBY_PRICE_SAR,
  TABBY_AMOUNT_USD,
  createPayPalOrderForCheckout,
  submitPaypalOrder,
  submitWalletOrder,
  getMyOrders,
  getMyOrderById,
  getAllOrders,
  updateOrder,
  requestRefund,
  processRefund,
  getFileForDownload,
  uploadOrderFile,
  deleteOrder,
};
