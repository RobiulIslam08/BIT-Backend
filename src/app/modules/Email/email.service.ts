// ============================================
// BIT SOFTWARE — Business Email Asset Service
// ============================================

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { Email } from './email.model';
import { IEmail } from './email.interface';
import { User } from '../User/user.model';
import { encryptCredential, decryptCredential } from '../../utils/credentialCrypto';
import { sendEmail } from '../../utils/sendEmail';

const webmailAccessCooldown = new Map<string, number>();

const normalizeOptional = (value?: string | null): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

const hasCompleteWebmailCredentials = (doc: {
  webmailUrl?: string | null;
  webmailUsername?: string | null;
  webmailPassword?: string | null;
}): boolean =>
  Boolean(doc?.webmailUrl?.trim() && doc?.webmailUsername?.trim() && doc?.webmailPassword);

const addBillingPeriod = (base: Date, cycle: 'monthly' | 'yearly'): Date => {
  const d = new Date(base);
  if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
};

export const toCustomerEmail = (doc: Record<string, any>) => {
  if (!doc) return doc;
  const {
    notes,
    internalProvider,
    internalAccountNote,
    assignedBy,
    webmailPassword,
    __v,
    ...safe
  } = doc;

  safe.hasWebmailAccess = hasCompleteWebmailCredentials({
    webmailUrl: safe.webmailUrl,
    webmailUsername: safe.webmailUsername,
    webmailPassword,
  });

  delete safe.webmailPassword;

  if (!safe.hasWebmailAccess) {
    if (!safe.webmailUrl) delete safe.webmailUrl;
    if (!safe.webmailUsername) delete safe.webmailUsername;
  }

  return safe;
};

const toAdminEmail = (doc: Record<string, any>) => {
  if (!doc) return doc;
  const out = { ...doc };
  const storedPassword = out.webmailPassword;
  out.hasWebmailPassword = Boolean(storedPassword);
  out.hasWebmailAccess = hasCompleteWebmailCredentials({
    webmailUrl: out.webmailUrl,
    webmailUsername: out.webmailUsername,
    webmailPassword: storedPassword,
  });
  delete out.webmailPassword;
  return out;
};

export const createEmail = async (
  adminId: string,
  payload: Partial<IEmail> & { userId: string; planName: string },
): Promise<IEmail> => {
  const owner = await User.findById(payload.userId);
  if (!owner) throw new AppError(httpStatus.NOT_FOUND, 'Selected user was not found.');

  const now = new Date();
  const billingCycle = payload.billingCycle || 'yearly';
  const startsAt = payload.startsAt ? new Date(payload.startsAt) : now;
  let expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : undefined;
  if (!expiresAt) expiresAt = addBillingPeriod(startsAt, billingCycle);

  let status = payload.status ?? 'active';
  if (!payload.status && expiresAt < now) status = 'expired';

  const planSlug =
    payload.planSlug?.trim().toLowerCase() ||
    `email-${payload.planName.trim().toLowerCase().replace(/\s+/g, '-')}`;

  const encryptedPass = normalizeOptional((payload as any).webmailPassword)
    ? encryptCredential(String((payload as any).webmailPassword).trim())
    : undefined;

  const hasCreds = hasCompleteWebmailCredentials({
    webmailUrl: payload.webmailUrl,
    webmailUsername: payload.webmailUsername,
    webmailPassword: encryptedPass,
  });

  const created = await Email.create({
    userId: new mongoose.Types.ObjectId(payload.userId),
    planSlug,
    planName: payload.planName.trim(),
    billingCycle,
    features: payload.features ?? [],
    businessName: payload.businessName?.trim(),
    country: payload.country?.trim(),
    teamSize: payload.teamSize?.trim(),
    domainName: payload.domainName?.trim().toLowerCase(),
    domainOwnership: payload.domainOwnership,
    adminFirstName: payload.adminFirstName?.trim(),
    adminLastName: payload.adminLastName?.trim(),
    desiredEmailLocalPart: payload.desiredEmailLocalPart?.trim().toLowerCase(),
    recoveryEmail: payload.recoveryEmail?.trim().toLowerCase(),
    businessAddress: payload.businessAddress?.trim(),
    customerPhone: payload.customerPhone?.trim(),
    source: 'admin_assigned',
    status,
    provisioningStatus: payload.provisioningStatus || (hasCreds ? 'ready' : 'pending_setup'),
    startsAt,
    expiresAt,
    amountUSD: payload.amountUSD,
    renewPriceUSD: payload.renewPriceUSD ?? payload.amountUSD,
    emailPlanId: payload.emailPlanId
      ? new mongoose.Types.ObjectId(String(payload.emailPlanId))
      : undefined,
    notes: payload.notes,
    internalProvider: payload.internalProvider,
    internalAccountNote: payload.internalAccountNote,
    primaryEmail: normalizeOptional((payload as any).primaryEmail)?.toLowerCase(),
    webmailUrl: normalizeOptional((payload as any).webmailUrl),
    webmailUsername: normalizeOptional((payload as any).webmailUsername),
    webmailPassword: encryptedPass,
    assignedBy: new mongoose.Types.ObjectId(adminId),
  });

  return toAdminEmail(created.toObject()) as IEmail;
};

export const getAllEmails = async (query: Record<string, unknown>) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.provisioningStatus) filter.provisioningStatus = query.provisioningStatus;
  if (query.userId) filter.userId = new mongoose.Types.ObjectId(String(query.userId));
  if (query.search) {
    const term = String(query.search).trim();
    filter.$or = [
      { planName: { $regex: term, $options: 'i' } },
      { planSlug: { $regex: term, $options: 'i' } },
      { domainName: { $regex: term, $options: 'i' } },
      { businessName: { $regex: term, $options: 'i' } },
      { primaryEmail: { $regex: term, $options: 'i' } },
    ];
  }

  const [emails, total, renewAgg] = await Promise.all([
    Email.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email')
      .populate('assignedBy', 'name email')
      .lean(),
    Email.countDocuments(filter),
    Email.aggregate([
      { $match: filter },
      { $group: { _id: null, totalRenewPriceUSD: { $sum: { $ifNull: ['$renewPriceUSD', 0] } } } },
    ]),
  ]);

  return {
    emails: emails.map((e) => toAdminEmail(e)),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      totalRenewPriceUSD: renewAgg[0]?.totalRenewPriceUSD ?? 0,
    },
  };
};

export const getEmailByIdAdmin = async (id: string) => {
  const email = await Email.findById(id)
    .populate('userId', 'name email phone')
    .populate('assignedBy', 'name email')
    .lean();
  if (!email) throw new AppError(httpStatus.NOT_FOUND, 'Email subscription not found.');
  return toAdminEmail(email);
};

export const updateEmail = async (id: string, payload: Partial<IEmail>): Promise<IEmail> => {
  const email = await Email.findById(id);
  if (!email) throw new AppError(httpStatus.NOT_FOUND, 'Email subscription not found.');

  if (payload.userId) {
    const owner = await User.findById(String(payload.userId));
    if (!owner) throw new AppError(httpStatus.NOT_FOUND, 'Selected user was not found.');
    email.userId = new mongoose.Types.ObjectId(String(payload.userId));
  }

  if (payload.planSlug !== undefined) email.planSlug = payload.planSlug.trim().toLowerCase();
  if (payload.planName !== undefined) email.planName = payload.planName.trim();
  if (payload.billingCycle !== undefined) email.billingCycle = payload.billingCycle;
  if (payload.features !== undefined) email.features = payload.features;
  if (payload.businessName !== undefined) email.businessName = payload.businessName?.trim();
  if (payload.country !== undefined) email.country = payload.country?.trim();
  if (payload.teamSize !== undefined) email.teamSize = payload.teamSize?.trim();
  if (payload.domainName !== undefined) email.domainName = payload.domainName?.trim().toLowerCase();
  if (payload.domainOwnership !== undefined) email.domainOwnership = payload.domainOwnership;
  if (payload.adminFirstName !== undefined) email.adminFirstName = payload.adminFirstName?.trim();
  if (payload.adminLastName !== undefined) email.adminLastName = payload.adminLastName?.trim();
  if (payload.desiredEmailLocalPart !== undefined) {
    email.desiredEmailLocalPart = payload.desiredEmailLocalPart?.trim().toLowerCase();
  }
  if (payload.recoveryEmail !== undefined) {
    email.recoveryEmail = payload.recoveryEmail?.trim().toLowerCase();
  }
  if (payload.businessAddress !== undefined) email.businessAddress = payload.businessAddress?.trim();
  if (payload.customerPhone !== undefined) email.customerPhone = payload.customerPhone?.trim();
  if (payload.status !== undefined) email.status = payload.status;
  if (payload.provisioningStatus !== undefined) email.provisioningStatus = payload.provisioningStatus;
  if (payload.startsAt !== undefined) email.startsAt = payload.startsAt;
  if (payload.expiresAt !== undefined) email.expiresAt = payload.expiresAt;
  if (payload.amountUSD !== undefined) email.amountUSD = payload.amountUSD;
  if (payload.renewPriceUSD !== undefined) email.renewPriceUSD = payload.renewPriceUSD;
  if (payload.notes !== undefined) email.notes = payload.notes;
  if (payload.internalProvider !== undefined) email.internalProvider = payload.internalProvider;
  if (payload.internalAccountNote !== undefined) {
    email.internalAccountNote = payload.internalAccountNote;
  }

  if ((payload as any).primaryEmail !== undefined) {
    email.primaryEmail = normalizeOptional((payload as any).primaryEmail)?.toLowerCase() ?? null;
  }
  if ((payload as any).webmailUrl !== undefined) {
    email.webmailUrl = normalizeOptional((payload as any).webmailUrl) ?? null;
  }
  if ((payload as any).webmailUsername !== undefined) {
    email.webmailUsername = normalizeOptional((payload as any).webmailUsername) ?? null;
  }
  if ((payload as any).webmailPassword !== undefined) {
    const nextPass = String((payload as any).webmailPassword ?? '').trim();
    if (nextPass) email.webmailPassword = encryptCredential(nextPass);
  }

  if (
    hasCompleteWebmailCredentials({
      webmailUrl: email.webmailUrl,
      webmailUsername: email.webmailUsername,
      webmailPassword: email.webmailPassword,
    }) &&
    payload.provisioningStatus === undefined
  ) {
    email.provisioningStatus = 'ready';
  }

  await email.save();
  return toAdminEmail(email.toObject()) as IEmail;
};

export const deleteEmail = async (id: string) => {
  const email = await Email.findByIdAndDelete(id);
  if (!email) throw new AppError(httpStatus.NOT_FOUND, 'Email subscription not found.');
  return { deleted: true };
};

export const searchUsers = async (search?: string) => {
  const filter: Record<string, unknown> = {};
  if (search && search.trim()) {
    const term = search.trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
    ];
  }
  return User.find(filter).select('name email phone').sort({ createdAt: -1 }).limit(20).lean();
};

export const getMyEmails = async (userId: string) => {
  const emails = await Email.find({ userId: new mongoose.Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .lean();
  return emails.map((e) => toCustomerEmail(e));
};

export const getMyEmailById = async (userId: string, id: string) => {
  const email = await Email.findOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();
  if (!email) throw new AppError(httpStatus.NOT_FOUND, 'Email subscription not found.');
  return toCustomerEmail(email);
};

const escapeHtml = (value: string): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const sendWebmailAccessEmail = async (userId: string, id: string) => {
  const emailDoc = await Email.findOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!emailDoc) throw new AppError(httpStatus.NOT_FOUND, 'Email subscription not found.');

  if (emailDoc.status !== 'active') {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'This Business Email subscription is not active.',
    );
  }

  if (
    !hasCompleteWebmailCredentials({
      webmailUrl: emailDoc.webmailUrl,
      webmailUsername: emailDoc.webmailUsername,
      webmailPassword: emailDoc.webmailPassword,
    })
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'Webmail access is not ready yet. Please wait while we finish setup.',
    );
  }

  const cooldownKey = String(emailDoc._id);
  const lastSent = webmailAccessCooldown.get(cooldownKey) || 0;
  if (Date.now() - lastSent < 2 * 60 * 1000) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      'Please wait a couple of minutes before requesting access details again.',
    );
  }

  const owner = await User.findById(userId).select('name email').lean();
  if (!owner?.email) throw new AppError(httpStatus.BAD_REQUEST, 'User email not found.');

  let plaintextPass: string;
  try {
    plaintextPass = decryptCredential(String(emailDoc.webmailPassword));
  } catch {
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Could not unlock credentials.');
  }

  const primary =
    emailDoc.primaryEmail ||
    (emailDoc.desiredEmailLocalPart && emailDoc.domainName
      ? `${emailDoc.desiredEmailLocalPart}@${emailDoc.domainName}`
      : emailDoc.webmailUsername);

  const safeName = escapeHtml(owner.name || 'Customer');
  const safePrimary = escapeHtml(String(primary || ''));
  const safeUrl = escapeHtml(String(emailDoc.webmailUrl || ''));
  const safeUser = escapeHtml(String(emailDoc.webmailUsername || ''));
  const safePass = escapeHtml(plaintextPass);

  await sendEmail(
    owner.email,
    `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">Your Business Email Access</h2>
        <p>Dear ${safeName},</p>
        <p>Your Business Email is ready. Use the details below to sign in:</p>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Email</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${safePrimary}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Webmail URL</td><td style="padding: 8px; border: 1px solid #e5e7eb;"><a href="${safeUrl}">${safeUrl}</a></td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Username</td><td style="padding: 8px; border: 1px solid #e5e7eb; font-family: monospace;">${safeUser}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Password</td><td style="padding: 8px; border: 1px solid #e5e7eb; font-family: monospace;">${safePass}</td></tr>
        </table>
        <p>You can also manage this subscription from <a href="${process.env.FRONTEND_URL}/my-account?tab=email">My Account → Email</a>.</p>
        <p>BIT Software &amp; IT Solution</p>
      </div>
    `,
    '🔐 Your Business Email Access — BIT Software',
  );

  webmailAccessCooldown.set(cooldownKey, Date.now());
  return { sent: true };
};
