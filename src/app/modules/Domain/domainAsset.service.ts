// ============================================
// BIT SOFTWARE — Domain Asset Service
// ============================================
// Canonical "owned domain" management:
//   • Admin: add legacy domains, assign to users, edit, delete
//   • User : list, view details, toggle auto-renew, renew (manual)
//   • System: auto-renew engine + expiry reminders
//
// ⚠️ WHITE-LABEL: the registrar (Namecheap) is used strictly behind the
//    scenes. No customer-facing message references any provider name.
// ============================================

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import config from '../../config';
import { Domain } from './domainAsset.model';
import { IDomain } from './domainAsset.interface';
import { DomainRenewal } from './domainRenewal.model';
import { DomainOrder } from '../DomainOrder/domainOrder.model';
import { TSupportedCurrency } from '../DomainOrder/domainOrder.interface';
import { User } from '../User/user.model';
import { getRenewPriceUSD, renewDomainOnNamecheap } from '../../utils/namecheap';
import {
  convertFromUSD,
  getDomainPriceUSD,
  sweepAbandonedCheckouts,
} from '../DomainOrder/domainOrder.service';
import {
  createPayPalOrder,
  capturePayPalOrder,
  refundPayPalCapture,
  chargeVaultedPayPal,
} from '../../utils/paypal';
import { getDefaultPaymentMethodDoc } from '../PaymentMethod/paymentMethod.service';
import { sendEmail } from '../../utils/sendEmail';

const RENEW_WINDOW_DAYS = 15; // auto-renew fires within this many days of expiry
const REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // resend reminder at most weekly

// ─── Helpers ───

const parseDomain = (domainName: string): { sld: string; tld: string } => {
  const cleaned = domainName.trim().toLowerCase();
  const dot = cleaned.indexOf('.');
  if (dot < 1) throw new AppError(httpStatus.BAD_REQUEST, 'Invalid domain name.');
  return { sld: cleaned.substring(0, dot), tld: cleaned.substring(dot + 1) };
};

const addYears = (base: Date, years: number): Date => {
  const d = new Date(base);
  d.setFullYear(d.getFullYear() + years);
  return d;
};

// Extend from the later of (current expiry, now) so paid time is never lost.
const nextExpiry = (currentExpiry: Date | undefined, years: number): Date => {
  const now = new Date();
  const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
  return addYears(base, years);
};

const getAdminEmail = (): string =>
  process.env.ADMIN_EMAIL?.trim() || config.smtp_user || 'admin@bitsoftwareitsolution.com';

/**
 * Resolve the renewal fee (USD) for a domain.
 * - Provider-managed domains → live registrar renew price (falls back to stored).
 * - Legacy / manual domains  → the admin-entered price (falls back to base price).
 */
export const resolveRenewPriceUSD = async (
  domain: Pick<IDomain, 'tld' | 'managedByNamecheap' | 'renewPriceUSD'>,
): Promise<{ priceUSD: number; source: 'provider' | 'manual' }> => {
  if (domain.managedByNamecheap) {
    const live = await getRenewPriceUSD(domain.tld);
    if (live && live > 0) return { priceUSD: parseFloat(live.toFixed(2)), source: 'provider' };
  }
  if (typeof domain.renewPriceUSD === 'number' && domain.renewPriceUSD > 0) {
    return { priceUSD: parseFloat(domain.renewPriceUSD.toFixed(2)), source: 'manual' };
  }
  // Last-resort fallback so the UI always has a number to show.
  return { priceUSD: await getDomainPriceUSD(domain.tld), source: 'manual' };
};

// ============================================
// ADMIN
// ============================================

export const createDomain = async (
  adminId: string,
  payload: Partial<IDomain> & { userId: string; domainName: string },
): Promise<IDomain> => {
  const domainName = payload.domainName.trim().toLowerCase();
  const { sld, tld } = parseDomain(domainName);

  // Owner must exist.
  const owner = await User.findById(payload.userId);
  if (!owner) throw new AppError(httpStatus.NOT_FOUND, 'Selected user was not found.');

  // No duplicates.
  const existing = await Domain.findOne({ domainName });
  if (existing) {
    throw new AppError(httpStatus.CONFLICT, `Domain "${domainName}" already exists in the system.`);
  }

  const managedByNamecheap = payload.managedByNamecheap ?? false;

  // Determine renewal price + source.
  let renewPriceUSD = payload.renewPriceUSD;
  let renewPriceSource: 'provider' | 'manual' = 'manual';
  if (typeof renewPriceUSD === 'number' && renewPriceUSD >= 0) {
    renewPriceSource = 'manual';
  } else if (managedByNamecheap) {
    const live = await getRenewPriceUSD(tld);
    if (live && live > 0) {
      renewPriceUSD = parseFloat(live.toFixed(2));
      renewPriceSource = 'provider';
    }
  }

  // Derive status from expiry if not explicitly set.
  let status = payload.status ?? 'active';
  if (!payload.status && payload.expiresAt && new Date(payload.expiresAt) < new Date()) {
    status = 'expired';
  }

  const created = await Domain.create({
    userId: new mongoose.Types.ObjectId(payload.userId),
    domainName,
    sld,
    tld,
    source: 'admin_assigned',
    registrar: payload.registrar?.trim() || 'BIT',
    managedByNamecheap,
    status,
    registeredAt: payload.registeredAt,
    expiresAt: payload.expiresAt,
    registrationYears: payload.registrationYears ?? 1,
    renewPriceUSD,
    renewPriceSource,
    autoRenew: payload.autoRenew ?? false,
    autoRenewStatus: 'inactive',
    whoisPrivacy: payload.whoisPrivacy ?? true,
    nameservers: payload.nameservers ?? [],
    notes: payload.notes,
    assignedBy: new mongoose.Types.ObjectId(adminId),
  });

  return created.toObject() as IDomain;
};

export const getAllDomains = async (query: Record<string, unknown>) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.userId) filter.userId = new mongoose.Types.ObjectId(String(query.userId));
  if (query.autoRenew !== undefined && query.autoRenew !== '') {
    filter.autoRenew = query.autoRenew === 'true' || query.autoRenew === true;
  }
  if (query.search) {
    filter.domainName = { $regex: String(query.search).trim().toLowerCase(), $options: 'i' };
  }

  const [domains, total] = await Promise.all([
    Domain.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email')
      .populate('assignedBy', 'name email')
      .lean(),
    Domain.countDocuments(filter),
  ]);

  return {
    domains,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getDomainByIdAdmin = async (id: string) => {
  const domain = await Domain.findById(id)
    .populate('userId', 'name email phone')
    .populate('assignedBy', 'name email')
    .lean();
  if (!domain) throw new AppError(httpStatus.NOT_FOUND, 'Domain not found.');
  return domain;
};

export const updateDomain = async (id: string, payload: Partial<IDomain>): Promise<IDomain> => {
  const domain = await Domain.findById(id);
  if (!domain) throw new AppError(httpStatus.NOT_FOUND, 'Domain not found.');

  if (payload.domainName && payload.domainName.toLowerCase() !== domain.domainName) {
    const domainName = payload.domainName.trim().toLowerCase();
    const { sld, tld } = parseDomain(domainName);
    const dup = await Domain.findOne({ domainName, _id: { $ne: domain._id } });
    if (dup) throw new AppError(httpStatus.CONFLICT, `Domain "${domainName}" already exists.`);
    domain.domainName = domainName;
    domain.sld = sld;
    domain.tld = tld;
  }

  if (payload.userId) {
    const owner = await User.findById(String(payload.userId));
    if (!owner) throw new AppError(httpStatus.NOT_FOUND, 'Selected user was not found.');
    domain.userId = new mongoose.Types.ObjectId(String(payload.userId));
  }

  if (payload.registrar !== undefined) domain.registrar = payload.registrar.trim() || 'BIT';
  if (payload.managedByNamecheap !== undefined) domain.managedByNamecheap = payload.managedByNamecheap;
  if (payload.status !== undefined) domain.status = payload.status;
  if (payload.registeredAt !== undefined) domain.registeredAt = payload.registeredAt;
  if (payload.expiresAt !== undefined) domain.expiresAt = payload.expiresAt;
  if (payload.registrationYears !== undefined) domain.registrationYears = payload.registrationYears;
  if (payload.whoisPrivacy !== undefined) domain.whoisPrivacy = payload.whoisPrivacy;
  if (payload.nameservers !== undefined) domain.nameservers = payload.nameservers;
  if (payload.notes !== undefined) domain.notes = payload.notes;

  if (payload.renewPriceUSD !== undefined) {
    domain.renewPriceUSD = payload.renewPriceUSD;
    domain.renewPriceSource = 'manual';
  }

  if (payload.autoRenew !== undefined) {
    domain.autoRenew = payload.autoRenew;
    if (!payload.autoRenew) domain.autoRenewStatus = 'inactive';
  }

  await domain.save();
  return domain.toObject() as IDomain;
};

export const deleteDomain = async (id: string) => {
  const domain = await Domain.findByIdAndDelete(id);
  if (!domain) throw new AppError(httpStatus.NOT_FOUND, 'Domain not found.');
  return { deleted: true };
};

/**
 * Search users for the admin "assign to user" picker.
 */
export const searchUsers = async (search?: string) => {
  const filter: Record<string, unknown> = {};
  if (search && search.trim()) {
    const term = search.trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
    ];
  }
  const users = await User.find(filter).select('name email phone').sort({ createdAt: -1 }).limit(20).lean();
  return users;
};

// ============================================
// USER
// ============================================

/**
 * Idempotently ensure every ACTIVE purchase order is represented as a
 * canonical Domain asset. Guarantees old + new purchases appear together.
 */
export const syncUserDomainsFromOrders = async (userId: string): Promise<void> => {
  const orders = await DomainOrder.find({
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: 'active',
  }).lean();

  for (const o of orders) {
    await Domain.updateOne(
      { domainName: o.domainName },
      {
        $setOnInsert: {
          userId: o.userId,
          domainName: o.domainName,
          sld: o.sld,
          tld: o.tld,
          source: 'purchase',
          registrar: 'BIT',
          managedByNamecheap: true,
          status: 'active',
          registeredAt: o.registeredAt,
          expiresAt: o.expiresAt,
          registrationYears: o.registrationYears || 1,
          renewPriceSource: 'provider',
          whoisPrivacy: o.whoisPrivacy,
          autoRenew: false,
          autoRenewStatus: 'inactive',
          nameservers: [],
          domainOrderId: o._id,
        },
      },
      { upsert: true },
    );
  }
};

export const getUserDomains = async (userId: string) => {
  await syncUserDomainsFromOrders(userId);
  return Domain.find({ userId: new mongoose.Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .lean();
};

export const getUserDomainById = async (userId: string, id: string) => {
  const domain = await Domain.findOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();
  if (!domain) throw new AppError(httpStatus.NOT_FOUND, 'Domain not found.');

  // Resolve the live renewal fee for display.
  const { priceUSD, source } = await resolveRenewPriceUSD(domain);
  const paymentMethod = await getDefaultPaymentMethodDoc(new mongoose.Types.ObjectId(userId));

  return {
    ...domain,
    renewPriceUSD: priceUSD,
    renewPriceSource: source,
    hasSavedPaymentMethod: !!paymentMethod,
  };
};

export const toggleAutoRenew = async (userId: string, id: string, autoRenew: boolean) => {
  const domain = await Domain.findOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!domain) throw new AppError(httpStatus.NOT_FOUND, 'Domain not found.');

  const paymentMethod = await getDefaultPaymentMethodDoc(new mongoose.Types.ObjectId(userId));
  const hasPaymentMethod = !!paymentMethod;

  domain.autoRenew = autoRenew;
  if (autoRenew) {
    domain.autoRenewStatus = hasPaymentMethod ? 'ready' : 'inactive';
  } else {
    domain.autoRenewStatus = 'inactive';
  }
  await domain.save();

  return {
    domain: domain.toObject() as IDomain,
    needsPaymentMethod: autoRenew && !hasPaymentMethod,
  };
};

// ─── Manual renewal (user-initiated, PayPal) ───

export const createRenewOrder = async (payload: {
  userId: string;
  domainId: string;
  displayCurrency: TSupportedCurrency;
}) => {
  const { userId, domainId, displayCurrency } = payload;

  const domain = await Domain.findOne({
    _id: domainId,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!domain) throw new AppError(httpStatus.NOT_FOUND, 'Domain not found.');

  const years = 1;
  const { priceUSD } = await resolveRenewPriceUSD(domain);
  const { displayAmount, rate } = await convertFromUSD(priceUSD, displayCurrency);

  const paypalRes = await createPayPalOrder(
    priceUSD.toFixed(2),
    `Domain Renewal: ${domain.domainName} (${years} year)`,
    'domain',
  );
  const paypalOrderId = paypalRes.id;
  if (!paypalOrderId) throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to create payment order.');

  await DomainRenewal.create({
    domainId: domain._id,
    userId: domain.userId,
    domainName: domain.domainName,
    tld: domain.tld,
    type: 'manual',
    years,
    amountUSD: priceUSD,
    displayCurrency,
    displayAmount,
    exchangeRateUsed: rate,
    managedByNamecheap: domain.managedByNamecheap,
    paymentStatus: 'pending',
    paypalOrderId,
    status: 'pending',
    previousExpiresAt: domain.expiresAt,
  });

  return { paypalOrderId, amountUSD: priceUSD, displayAmount, displayCurrency };
};

export const completeRenew = async (payload: { userId: string; paypalOrderId: string }) => {
  const { userId, paypalOrderId } = payload;

  // Atomic claim: only one concurrent request can move pending → processing.
  // Prevents a losing race from overwriting a successful renewal with "failed".
  const renewal = await DomainRenewal.findOneAndUpdate(
    {
      paypalOrderId,
      userId: new mongoose.Types.ObjectId(userId),
      status: 'pending',
    },
    { $set: { status: 'processing' } },
    { new: true },
  );

  if (!renewal) {
    const existing = await DomainRenewal.findOne({
      paypalOrderId,
      userId: new mongoose.Types.ObjectId(userId),
    });
    if (existing && (existing.status === 'completed' || existing.status === 'processing')) {
      // Already completed, or another request is currently processing it.
      const dom = await Domain.findById(existing.domainId).lean();
      if (existing.status === 'completed' && dom) return dom;
      throw new AppError(
        httpStatus.CONFLICT,
        'This renewal is already being processed. Please wait a moment and refresh.',
      );
    }
    throw new AppError(httpStatus.NOT_FOUND, 'Renewal request not found or already processed.');
  }

  const domain = await Domain.findById(renewal.domainId);
  if (!domain) {
    renewal.status = 'failed';
    renewal.failureReason = 'Domain not found.';
    await renewal.save();
    throw new AppError(httpStatus.NOT_FOUND, 'Domain not found.');
  }

  // 1. Capture payment (server-side).
  let captureResult: any;
  try {
    captureResult = await capturePayPalOrder(paypalOrderId);
  } catch (err: any) {
    renewal.status = 'failed';
    renewal.paymentStatus = 'failed';
    renewal.failureReason = `Payment capture failed: ${err.message}`;
    await renewal.save();
    throw new AppError(httpStatus.PAYMENT_REQUIRED, 'Payment could not be processed.');
  }

  if (captureResult?.status !== 'COMPLETED') {
    renewal.status = 'failed';
    renewal.paymentStatus = 'failed';
    renewal.failureReason = `Payment not completed. Status: ${captureResult?.status}`;
    await renewal.save();
    throw new AppError(httpStatus.PAYMENT_REQUIRED, 'Payment was not completed.');
  }

  const captureUnit = captureResult?.purchase_units?.[0]?.payments?.captures?.[0];
  const captureId = captureUnit?.id ?? null;
  const capturedAmount = parseFloat(captureUnit?.amount?.value ?? '0');
  const capturedCurrency = captureUnit?.amount?.currency_code ?? 'USD';

  if (capturedCurrency !== 'USD' || Math.abs(capturedAmount - renewal.amountUSD) > 0.01) {
    if (captureId) {
      try {
        await refundPayPalCapture(captureId, capturedAmount.toFixed(2), capturedCurrency);
      } catch {
        /* logged in util */
      }
    }
    renewal.status = 'failed';
    renewal.paymentStatus = 'refunded';
    renewal.paypalCaptureId = captureId ?? undefined;
    renewal.failureReason = 'Payment amount mismatch — refunded.';
    await renewal.save();
    throw new AppError(httpStatus.PAYMENT_REQUIRED, 'Payment amount mismatch. A refund has been issued.');
  }

  renewal.paymentStatus = 'paid';
  renewal.paypalCaptureId = captureId ?? undefined;
  await renewal.save();

  // 2. Fulfil the renewal.
  await fulfilRenewal(domain, renewal, captureId);

  // 3. Notify the customer.
  await sendRenewalSuccessEmail(domain, renewal);

  return domain.toObject() as IDomain;
};

/**
 * Apply a PAID renewal: extend expiry, renew at provider if managed,
 * or flag for manual registrar action if legacy.
 * On provider failure for a managed domain, the payment is refunded.
 */
const fulfilRenewal = async (
  domain: mongoose.Document & IDomain,
  renewal: mongoose.Document & { [k: string]: any },
  captureId: string | null,
) => {
  const years = renewal.years || 1;

  if (domain.managedByNamecheap) {
    try {
      const result = await renewDomainOnNamecheap(domain.domainName, years);
      const newExpiry = result.expiresAt || nextExpiry(domain.expiresAt, years);
      domain.expiresAt = newExpiry;
      domain.status = 'active';
      domain.lastRenewedAt = new Date();
      await domain.save();

      renewal.status = 'completed';
      renewal.providerOrderId = result.providerOrderId ?? undefined;
      renewal.newExpiresAt = newExpiry;
      await renewal.save();
      return;
    } catch (err: any) {
      // Provider renewal failed after payment → refund.
      if (captureId) {
        try {
          await refundPayPalCapture(captureId, renewal.amountUSD.toFixed(2), 'USD');
          renewal.paymentStatus = 'refunded';
        } catch {
          /* manual refund required — logged in util */
        }
      }
      renewal.status = 'failed';
      renewal.failureReason = err.message || 'Provider renewal failed.';
      await renewal.save();
      throw new AppError(
        httpStatus.BAD_GATEWAY,
        renewal.paymentStatus === 'refunded'
          ? 'The renewal could not be completed and your payment has been refunded.'
          : 'The renewal could not be completed. Our team will contact you shortly.',
      );
    }
  }

  // Legacy / non-managed domain: we accept payment and extend our record,
  // then alert the team to renew at the actual registrar behind the scenes.
  const newExpiry = nextExpiry(domain.expiresAt, years);
  domain.expiresAt = newExpiry;
  domain.status = 'active';
  domain.lastRenewedAt = new Date();
  await domain.save();

  renewal.status = 'completed';
  renewal.requiresManualRegistrarAction = true;
  renewal.newExpiresAt = newExpiry;
  await renewal.save();

  await sendAdminManualRenewalAlert(domain, renewal);
};

// ============================================
// AUTO-RENEW ENGINE (cron / admin triggered)
// ============================================

export const runRenewalEngine = async () => {
  const now = new Date();
  const windowDate = new Date(now.getTime() + RENEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Housekeeping: gracefully cancel unpaid, abandoned checkouts (non-critical).
  let abandonedSwept = 0;
  try {
    abandonedSwept = await sweepAbandonedCheckouts();
  } catch (err) {
    console.error('[RenewalEngine] Abandoned checkout sweep failed (non-critical):', err);
  }

  const dueDomains = await Domain.find({
    autoRenew: true,
    status: { $in: ['active', 'expired'] },
    expiresAt: { $lte: windowDate },
  });

  const summary = { scanned: dueDomains.length, renewed: 0, failed: 0, notified: 0, skipped: 0, abandonedSwept };

  for (const domain of dueDomains) {
    // Don't act twice within a day.
    if (domain.lastRenewedAt && now.getTime() - new Date(domain.lastRenewedAt).getTime() < 24 * 60 * 60 * 1000) {
      summary.skipped += 1;
      continue;
    }

    const paymentMethod = await getDefaultPaymentMethodDoc(domain.userId as mongoose.Types.ObjectId);
    const { priceUSD } = await resolveRenewPriceUSD(domain);

    const canAutoCharge = domain.managedByNamecheap && !!paymentMethod;

    if (canAutoCharge) {
      const renewal = await DomainRenewal.create({
        domainId: domain._id,
        userId: domain.userId,
        domainName: domain.domainName,
        tld: domain.tld,
        type: 'auto',
        years: 1,
        amountUSD: priceUSD,
        displayCurrency: 'USD',
        displayAmount: priceUSD,
        exchangeRateUsed: 1,
        managedByNamecheap: true,
        paymentStatus: 'pending',
        status: 'pending',
        previousExpiresAt: domain.expiresAt,
      });

      try {
        const charge = await chargeVaultedPayPal(
          paymentMethod!.vaultId,
          priceUSD.toFixed(2),
          `Domain Auto-Renewal: ${domain.domainName} (1 year)`,
        );
        renewal.paymentStatus = 'paid';
        renewal.paypalOrderId = charge.orderId;
        renewal.paypalCaptureId = charge.captureId;
        await renewal.save();

        await fulfilRenewal(domain as any, renewal as any, charge.captureId);

        domain.autoRenewStatus = 'ready';
        domain.lastAutoRenewError = undefined;
        await domain.save();

        await sendRenewalSuccessEmail(domain, renewal);
        summary.renewed += 1;
      } catch (err: any) {
        renewal.status = 'failed';
        if (renewal.paymentStatus === 'pending') renewal.paymentStatus = 'failed';
        renewal.failureReason = err.message || 'Auto-renewal failed.';
        await renewal.save();

        domain.autoRenewStatus = 'failed';
        domain.lastAutoRenewError = err.message || 'Auto-renewal failed.';
        await domain.save();

        await sendAutoRenewFailedEmail(domain, priceUSD);
        summary.failed += 1;
      }
    } else {
      // Cannot auto-charge (no saved method, or legacy registrar) → remind.
      const lastReminder = domain.expiryReminderSentAt
        ? new Date(domain.expiryReminderSentAt).getTime()
        : 0;
      if (now.getTime() - lastReminder < REMINDER_COOLDOWN_MS) {
        summary.skipped += 1;
        continue;
      }

      await sendExpiryReminderEmail(domain, priceUSD, !paymentMethod);
      if (!domain.managedByNamecheap) {
        await sendAdminManualRenewalAlert(domain, null);
      }
      domain.expiryReminderSentAt = now;
      await domain.save();
      summary.notified += 1;
    }
  }

  return summary;
};

// ============================================
// EMAILS (white-label — no provider names)
// ============================================

const fmtDate = (d?: Date | null) => (d ? new Date(d).toDateString() : '—');

const emailShell = (title: string, color: string, inner: string) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <h2 style="color: ${color};">${title}</h2>
    ${inner}
    <p style="margin-top:16px;">You can manage your domains anytime from
      <a href="${process.env.FRONTEND_URL || ''}/my-account">My Account</a>.</p>
    <p>Thank you for choosing BIT Software &amp; IT Solution.</p>
  </div>`;

const sendRenewalSuccessEmail = async (domain: IDomain, renewal: any) => {
  try {
    const owner = await User.findById(domain.userId).select('name email').lean();
    if (!owner?.email) return;
    await sendEmail(
      owner.email,
      emailShell('Domain Renewed Successfully', '#16a34a', `
        <p>Dear ${owner.name || 'Customer'},</p>
        <p>Your domain <strong>${domain.domainName}</strong> has been renewed.</p>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
          <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Domain</td><td style="padding:8px;border:1px solid #e5e7eb;">${domain.domainName}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">New Expiry</td><td style="padding:8px;border:1px solid #e5e7eb;">${fmtDate(renewal.newExpiresAt || domain.expiresAt)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Amount</td><td style="padding:8px;border:1px solid #e5e7eb;">$${renewal.amountUSD} USD</td></tr>
        </table>`),
      `Domain "${domain.domainName}" Renewed — BIT Software`,
    );
  } catch (err) {
    console.error('[DomainRenewal] success email failed:', err);
  }
};

const sendAutoRenewFailedEmail = async (domain: IDomain, priceUSD: number) => {
  try {
    const owner = await User.findById(domain.userId).select('name email').lean();
    if (!owner?.email) return;
    await sendEmail(
      owner.email,
      emailShell('Action Needed: Auto-Renewal Could Not Be Completed', '#d97706', `
        <p>Dear ${owner.name || 'Customer'},</p>
        <p>We tried to automatically renew <strong>${domain.domainName}</strong> (expiring ${fmtDate(domain.expiresAt)}) for <strong>$${priceUSD} USD</strong>, but the payment could not be completed.</p>
        <p>Please renew manually or update your saved payment method to avoid losing your domain.</p>`),
      `Action Needed: Renew "${domain.domainName}" — BIT Software`,
    );
  } catch (err) {
    console.error('[DomainRenewal] auto-fail email failed:', err);
  }
};

const sendExpiryReminderEmail = async (domain: IDomain, priceUSD: number, noPaymentMethod: boolean) => {
  try {
    const owner = await User.findById(domain.userId).select('name email').lean();
    if (!owner?.email) return;
    await sendEmail(
      owner.email,
      emailShell('Your Domain Is Expiring Soon', '#d97706', `
        <p>Dear ${owner.name || 'Customer'},</p>
        <p>Your domain <strong>${domain.domainName}</strong> expires on <strong>${fmtDate(domain.expiresAt)}</strong>.</p>
        <p>Renewal fee: <strong>$${priceUSD} USD</strong>.</p>
        ${
          noPaymentMethod
            ? '<p>Auto-renew is enabled, but no saved payment method was found. Please add one or renew manually.</p>'
            : '<p>Please renew to keep your domain active.</p>'
        }`),
      `Reminder: "${domain.domainName}" expires ${fmtDate(domain.expiresAt)} — BIT Software`,
    );
  } catch (err) {
    console.error('[DomainRenewal] reminder email failed:', err);
  }
};

const sendAdminManualRenewalAlert = async (domain: IDomain, renewal: any | null) => {
  try {
    await sendEmail(
      getAdminEmail(),
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color:#dc2626;">Manual Registrar Renewal Required</h2>
        <p>The domain <strong>${domain.domainName}</strong> needs to be renewed at its registrar
        (<strong>${domain.registrar}</strong>) — it is not managed through our provider account.</p>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
          <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Domain</td><td style="padding:8px;border:1px solid #e5e7eb;">${domain.domainName}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Registrar</td><td style="padding:8px;border:1px solid #e5e7eb;">${domain.registrar}</td></tr>
          <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Expires</td><td style="padding:8px;border:1px solid #e5e7eb;">${fmtDate(domain.expiresAt)}</td></tr>
          ${renewal ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Customer Paid</td><td style="padding:8px;border:1px solid #e5e7eb;">$${renewal.amountUSD} USD (renewal ${renewal._id})</td></tr>` : ''}
        </table>
        <p>Please complete the renewal at the registrar to fulfil this order.</p>
      </div>`,
      `[ACTION] Renew "${domain.domainName}" at registrar — BIT Software`,
    );
  } catch (err) {
    console.error('[DomainRenewal] admin alert failed:', err);
  }
};

/**
 * Called by the purchase flow when a domain order becomes active.
 * Upserts the canonical Domain asset. Safe to call more than once.
 */
export const upsertDomainFromOrder = async (order: {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  domainName: string;
  sld: string;
  tld: string;
  registrationYears?: number;
  whoisPrivacy?: boolean;
  registeredAt?: Date;
  expiresAt?: Date;
}): Promise<void> => {
  await Domain.updateOne(
    { domainName: order.domainName },
    {
      $setOnInsert: {
        userId: order.userId,
        domainName: order.domainName,
        sld: order.sld,
        tld: order.tld,
        source: 'purchase',
        registrar: 'BIT',
        managedByNamecheap: true,
        status: 'active',
        registeredAt: order.registeredAt,
        expiresAt: order.expiresAt,
        registrationYears: order.registrationYears || 1,
        renewPriceSource: 'provider',
        whoisPrivacy: order.whoisPrivacy ?? true,
        autoRenew: false,
        autoRenewStatus: 'inactive',
        nameservers: [],
        domainOrderId: order._id,
      },
    },
    { upsert: true },
  );
};
