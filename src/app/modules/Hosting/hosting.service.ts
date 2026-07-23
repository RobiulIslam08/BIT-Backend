// ============================================
// BIT SOFTWARE — Hosting Asset Service
// ============================================
// Admin: assign legacy hosting, edit, upload project ZIP, delete
// User : list, view details, download project ZIP
//
// ⚠️ WHITE-LABEL: never expose internalProvider / notes / internalServerNote
//    to customer-facing responses.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import mongoose from 'mongoose';
import httpStatus from 'http-status';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import AppError from '../../errors/AppError';
import config from '../../config';
import { Hosting } from './hosting.model';
import { IHosting } from './hosting.interface';
import { User } from '../User/user.model';
import { getHostingProjectsDir } from '../../utils/uploadPaths';
import { encryptCredential, decryptCredential } from '../../utils/credentialCrypto';
import { sendEmail } from '../../utils/sendEmail';

const PROJECT_UPLOAD_DIR = () => getHostingProjectsDir();

const ensureUploadDir = () => {
  getHostingProjectsDir();
};

const normalizeOptional = (value?: string | null): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

const hasCompleteCpanelCredentials = (doc: {
  cpanelUrl?: string | null;
  cpanelUsername?: string | null;
  cpanelPassword?: string | null;
}): boolean =>
  Boolean(
    doc?.cpanelUrl?.trim() &&
      doc?.cpanelUsername?.trim() &&
      doc?.cpanelPassword,
  );

const normalizeCpanelOrigin = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'Invalid cPanel URL. Use the base URL only, e.g. https://server.example.com:2083',
    );
  }
  // Reject session URLs — admin must store the base host, not a temporary cpsess link
  if (/\/cpsess\d+/i.test(parsed.pathname)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'Do not use a cpsess session URL. Save only the base cPanel URL (https://host:2083).',
    );
  }
  return `${parsed.protocol}//${parsed.host}`;
};

/**
 * Server-side cPanel login (LogMeIn-style).
 * Returns a one-time browser URL: /cpsess…/login/?session=…
 * Browser form POST alone often fails on modern cPanel (security tokens / cookies).
 */
const createCpanelOneTimeLoginUrl = async (
  cpanelUrl: string,
  username: string,
  password: string,
): Promise<string> => {
  const origin = normalizeCpanelOrigin(cpanelUrl);
  const loginUrl = `${origin}/login/`;

  // Allow self-signed certs common on hosting panels
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  let response;
  try {
    response = await axios.post(
      loginUrl,
      new URLSearchParams({
        user: username,
        pass: password,
        goto_uri: '/',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Connection: 'close',
          'User-Agent': 'BIT-Software-cPanel-SSO/1.0',
        },
        httpsAgent,
        maxRedirects: 0,
        validateStatus: () => true,
        timeout: 20000,
        responseType: 'text',
        transformResponse: [(data) => data],
      },
    );
  } catch (err) {
    console.error('[Hosting] cPanel login request failed:', err);
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      'Could not reach the cPanel server. Check the cPanel URL and try again.',
    );
  }

  const setCookie = response.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie)
    ? setCookie.join('; ')
    : String(setCookie || '');

  let sessionMatch = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/i);
  if (!sessionMatch) {
    // Some panels put session only on one cookie line
    sessionMatch = cookieHeader.match(/session=([^;]+)/i);
  }

  const body = typeof response.data === 'string' ? response.data : String(response.data ?? '');
  const location = String(response.headers.location || '');

  // Direct Location with session already embedded
  if (location) {
    try {
      const abs = new URL(location, origin).href;
      if (/cpsess\d+/i.test(abs) && /session=/i.test(abs)) {
        return abs;
      }
    } catch {
      /* ignore */
    }
  }

  const cpsessMatch =
    body.match(/<META\s+HTTP-EQUIV=["']refresh["'][^>]*URL=\/(cpsess\d+)\//i) ||
    body.match(/URL=\/(cpsess\d+)\//i) ||
    location.match(/\/(cpsess\d+)\//i);

  if (!sessionMatch?.[1] || !cpsessMatch?.[1]) {
    console.error('[Hosting] cPanel login parse failed', {
      status: response.status,
      hasSession: Boolean(sessionMatch),
      hasCpsess: Boolean(cpsessMatch),
      location: location.slice(0, 200),
    });
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      'cPanel login failed. Verify username/password, or use “cPanel Access” email and log in manually.',
    );
  }

  const session = sessionMatch[1];
  const cpsess = cpsessMatch[1];
  return `${origin}/${cpsess}/login/?session=${session}`;
};

const escapeHtml = (value: string): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Strip admin-only fields before sending to customers. */
export const toCustomerHosting = (doc: Record<string, any>) => {
  if (!doc) return doc;
  const {
    notes,
    internalProvider,
    internalServerNote,
    assignedBy,
    cpanelPassword,
    __v,
    ...safe
  } = doc;

  // Expose only whether a project file exists + metadata (not stored path internals)
  if (safe.projectFile) {
    safe.projectFile = {
      originalName: safe.projectFile.originalName,
      size: safe.projectFile.size,
      uploadedAt: safe.projectFile.uploadedAt,
      available: true,
    };
  } else {
    safe.projectFile = null;
  }

  safe.hasCpanelAccess = hasCompleteCpanelCredentials({
    cpanelUrl: safe.cpanelUrl,
    cpanelUsername: safe.cpanelUsername,
    cpanelPassword,
  });

  // Never expose password to customers
  delete safe.cpanelPassword;

  if (!safe.hasCpanelAccess) {
    // Hide partial credential noise when not fully provisioned
    if (!safe.cpanelUrl) delete safe.cpanelUrl;
    if (!safe.cpanelUsername) delete safe.cpanelUsername;
    if (!safe.cpanelDomain) delete safe.cpanelDomain;
  }

  return safe;
};

/** Admin responses: never return decrypted password (write-only on edit). */
const toAdminHosting = (doc: Record<string, any>) => {
  if (!doc) return doc;
  const out = { ...doc };
  const storedPassword = out.cpanelPassword;
  const hasPassword = Boolean(storedPassword);

  out.hasCpanelPassword = hasPassword;
  out.hasCpanelAccess = hasCompleteCpanelCredentials({
    cpanelUrl: out.cpanelUrl,
    cpanelUsername: out.cpanelUsername,
    cpanelPassword: storedPassword,
  });

  // Never send password (encrypted or plaintext) to the client
  delete out.cpanelPassword;

  return out;
};

const addBillingPeriod = (base: Date, cycle: 'monthly' | 'yearly'): Date => {
  const d = new Date(base);
  if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
};

// ============================================
// ADMIN
// ============================================

export const createHosting = async (
  adminId: string,
  payload: Partial<IHosting> & {
    userId: string;
    planName: string;
    planType: 'shared' | 'vps';
  },
): Promise<IHosting> => {
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
    `${payload.planType}-${payload.planName.trim().toLowerCase().replace(/\s+/g, '-')}`;

  const created = await Hosting.create({
    userId: new mongoose.Types.ObjectId(payload.userId),
    planSlug,
    planName: payload.planName.trim(),
    planType: payload.planType,
    billingCycle,
    features: payload.features ?? [],
    websiteLabel: payload.websiteLabel?.trim(),
    source: 'admin_assigned',
    status,
    startsAt,
    expiresAt,
    amountUSD: payload.amountUSD,
    renewPriceUSD: payload.renewPriceUSD ?? payload.amountUSD,
    hostingPlanId: payload.hostingPlanId
      ? new mongoose.Types.ObjectId(String(payload.hostingPlanId))
      : undefined,
    notes: payload.notes,
    internalProvider: payload.internalProvider,
    internalServerNote: payload.internalServerNote,
    cpanelUrl: normalizeOptional((payload as any).cpanelUrl),
    cpanelUsername: normalizeOptional((payload as any).cpanelUsername),
    cpanelPassword: normalizeOptional((payload as any).cpanelPassword)
      ? encryptCredential(String((payload as any).cpanelPassword).trim())
      : undefined,
    cpanelDomain: normalizeOptional((payload as any).cpanelDomain),
    assignedBy: new mongoose.Types.ObjectId(adminId),
  });

  return toAdminHosting(created.toObject()) as IHosting;
};

export const getAllHostings = async (query: Record<string, unknown>) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.planType) filter.planType = query.planType;
  if (query.userId) filter.userId = new mongoose.Types.ObjectId(String(query.userId));
  if (query.search) {
    const term = String(query.search).trim();
    filter.$or = [
      { planName: { $regex: term, $options: 'i' } },
      { planSlug: { $regex: term, $options: 'i' } },
      { websiteLabel: { $regex: term, $options: 'i' } },
    ];
  }

  const [hostings, total] = await Promise.all([
    Hosting.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email')
      .populate('assignedBy', 'name email')
      .lean(),
    Hosting.countDocuments(filter),
  ]);

  return {
    hostings: hostings.map((h) => toAdminHosting(h)),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getHostingByIdAdmin = async (id: string) => {
  const hosting = await Hosting.findById(id)
    .populate('userId', 'name email phone')
    .populate('assignedBy', 'name email')
    .lean();
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');
  return toAdminHosting(hosting);
};

export const updateHosting = async (id: string, payload: Partial<IHosting>): Promise<IHosting> => {
  const hosting = await Hosting.findById(id);
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');

  if (payload.userId) {
    const owner = await User.findById(String(payload.userId));
    if (!owner) throw new AppError(httpStatus.NOT_FOUND, 'Selected user was not found.');
    hosting.userId = new mongoose.Types.ObjectId(String(payload.userId));
  }

  if (payload.planSlug !== undefined) hosting.planSlug = payload.planSlug.trim().toLowerCase();
  if (payload.planName !== undefined) hosting.planName = payload.planName.trim();
  if (payload.planType !== undefined) hosting.planType = payload.planType;
  if (payload.billingCycle !== undefined) hosting.billingCycle = payload.billingCycle;
  if (payload.features !== undefined) hosting.features = payload.features;
  if (payload.websiteLabel !== undefined) hosting.websiteLabel = payload.websiteLabel?.trim();
  if (payload.status !== undefined) hosting.status = payload.status;
  if (payload.startsAt !== undefined) hosting.startsAt = payload.startsAt;
  if (payload.expiresAt !== undefined) hosting.expiresAt = payload.expiresAt;
  if (payload.amountUSD !== undefined) hosting.amountUSD = payload.amountUSD;
  if (payload.renewPriceUSD !== undefined) hosting.renewPriceUSD = payload.renewPriceUSD;
  if (payload.notes !== undefined) hosting.notes = payload.notes;
  if (payload.internalProvider !== undefined) hosting.internalProvider = payload.internalProvider;
  if (payload.internalServerNote !== undefined) hosting.internalServerNote = payload.internalServerNote;

  // cPanel credentials — empty string clears the field (null in DB)
  if ((payload as any).cpanelUrl !== undefined) {
    hosting.cpanelUrl = normalizeOptional((payload as any).cpanelUrl) ?? null;
  }
  if ((payload as any).cpanelUsername !== undefined) {
    hosting.cpanelUsername = normalizeOptional((payload as any).cpanelUsername) ?? null;
  }
  if ((payload as any).cpanelDomain !== undefined) {
    hosting.cpanelDomain = normalizeOptional((payload as any).cpanelDomain) ?? null;
  }
  // Empty password on update = keep existing; non-empty = replace (encrypted)
  if ((payload as any).cpanelPassword !== undefined) {
    const nextPass = String((payload as any).cpanelPassword ?? '').trim();
    if (nextPass) {
      hosting.cpanelPassword = encryptCredential(nextPass);
    }
  }

  await hosting.save();
  return toAdminHosting(hosting.toObject()) as IHosting;
};

export const deleteHosting = async (id: string) => {
  const hosting = await Hosting.findById(id);
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');

  // Remove project file from disk if present
  if (hosting.projectFile?.storedName) {
    const filePath = path.join(PROJECT_UPLOAD_DIR(), hosting.projectFile.storedName);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.error('[Hosting] Failed to delete project file:', err);
    }
  }

  await Hosting.findByIdAndDelete(id);
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

export const uploadProjectFile = async (
  id: string,
  adminId: string,
  file: Express.Multer.File,
) => {
  if (!file) throw new AppError(httpStatus.BAD_REQUEST, 'Project ZIP file is required.');

  const hosting = await Hosting.findById(id);
  if (!hosting) {
    // Clean up temp disk file if hosting missing
    if (file.path && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    }
    throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');
  }

  ensureUploadDir();

  // Delete previous file if any
  if (hosting.projectFile?.storedName) {
    const oldPath = path.join(PROJECT_UPLOAD_DIR(), hosting.projectFile.storedName);
    try {
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch {
      /* ignore */
    }
  }

  const ext = path.extname(file.originalname).toLowerCase() || '.zip';
  const storedName = `${hosting._id}-${Date.now()}${ext}`;
  const dest = path.join(PROJECT_UPLOAD_DIR(), storedName);

  // Multer diskStorage already wrote to disk (file.path). Rename into final name.
  // Fallback: memoryStorage buffer (should not happen for large files).
  if (file.path && fs.existsSync(file.path)) {
    try {
      fs.renameSync(file.path, dest);
    } catch {
      fs.copyFileSync(file.path, dest);
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    }
  } else if (file.buffer) {
    fs.writeFileSync(dest, file.buffer);
  } else {
    throw new AppError(httpStatus.BAD_REQUEST, 'Uploaded file data is missing.');
  }

  hosting.projectFile = {
    originalName: file.originalname,
    storedName,
    mimeType: file.mimetype || 'application/zip',
    size: file.size,
    uploadedAt: new Date(),
    uploadedBy: new mongoose.Types.ObjectId(adminId),
  };

  await hosting.save();
  return hosting.toObject() as IHosting;
};

// ─── Chunked upload (production-safe for Traefik / large ZIPs) ───

const getChunkTempDir = (uploadId: string) => {
  const safeId = String(uploadId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  if (!safeId) throw new AppError(httpStatus.BAD_REQUEST, 'Invalid uploadId.');
  const dir = path.join(PROJECT_UPLOAD_DIR(), '.chunks', safeId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const removeDirRecursive = (dir: string) => {
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
};

export const saveProjectChunk = async (payload: {
  hostingId: string;
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  file: Express.Multer.File;
}) => {
  const { hostingId, uploadId, chunkIndex, totalChunks, file } = payload;

  if (!file) throw new AppError(httpStatus.BAD_REQUEST, 'Chunk file is required.');
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid chunkIndex.');
  }
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 500) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid totalChunks.');
  }
  if (chunkIndex >= totalChunks) {
    throw new AppError(httpStatus.BAD_REQUEST, 'chunkIndex out of range.');
  }

  const hosting = await Hosting.findById(hostingId);
  if (!hosting) {
    if (file.path && fs.existsSync(file.path)) {
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    }
    throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');
  }

  const dir = getChunkTempDir(uploadId);
  const dest = path.join(dir, `${chunkIndex}.part`);

  if (file.path && fs.existsSync(file.path)) {
    try {
      fs.renameSync(file.path, dest);
    } catch {
      fs.copyFileSync(file.path, dest);
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
    }
  } else if (file.buffer) {
    fs.writeFileSync(dest, file.buffer);
  } else {
    throw new AppError(httpStatus.BAD_REQUEST, 'Uploaded chunk data is missing.');
  }

  return {
    uploadId,
    chunkIndex,
    totalChunks,
    received: true,
  };
};

export const completeChunkedProjectUpload = async (payload: {
  hostingId: string;
  adminId: string;
  uploadId: string;
  totalChunks: number;
  originalName: string;
  mimeType?: string;
  totalSize?: number;
}) => {
  const { hostingId, adminId, uploadId, totalChunks, originalName, mimeType, totalSize } = payload;

  if (!originalName?.trim()) {
    throw new AppError(httpStatus.BAD_REQUEST, 'originalName is required.');
  }
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 500) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid totalChunks.');
  }

  const hosting = await Hosting.findById(hostingId);
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');

  const dir = getChunkTempDir(uploadId);

  // Ensure every chunk exists
  for (let i = 0; i < totalChunks; i++) {
    const part = path.join(dir, `${i}.part`);
    if (!fs.existsSync(part)) {
      throw new AppError(httpStatus.BAD_REQUEST, `Missing chunk ${i + 1} of ${totalChunks}. Please retry upload.`);
    }
  }

  ensureUploadDir();

  // Remove previous project file
  if (hosting.projectFile?.storedName) {
    const oldPath = path.join(PROJECT_UPLOAD_DIR(), hosting.projectFile.storedName);
    try {
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch {
      /* ignore */
    }
  }

  const ext = path.extname(originalName).toLowerCase() || '.zip';
  const storedName = `${hosting._id}-${Date.now()}${ext}`;
  const dest = path.join(PROJECT_UPLOAD_DIR(), storedName);

  // Assemble chunks in order
  const writeStream = fs.createWriteStream(dest);
  try {
    for (let i = 0; i < totalChunks; i++) {
      const part = path.join(dir, `${i}.part`);
      const data = fs.readFileSync(part);
      writeStream.write(data);
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });
  } catch (err) {
    try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch { /* ignore */ }
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to assemble project file.');
  } finally {
    removeDirRecursive(dir);
  }

  const size = typeof totalSize === 'number' && totalSize > 0
    ? totalSize
    : fs.statSync(dest).size;

  if (size > 500 * 1024 * 1024) {
    try { fs.unlinkSync(dest); } catch { /* ignore */ }
    throw new AppError(httpStatus.REQUEST_ENTITY_TOO_LARGE, 'File too large. Maximum project ZIP size is 500 MB.');
  }

  hosting.projectFile = {
    originalName: originalName.trim(),
    storedName,
    mimeType: mimeType || 'application/zip',
    size,
    uploadedAt: new Date(),
    uploadedBy: new mongoose.Types.ObjectId(adminId),
  };

  await hosting.save();
  return hosting.toObject() as IHosting;
};

export const abortChunkedProjectUpload = async (uploadId: string) => {
  const dir = getChunkTempDir(uploadId);
  removeDirRecursive(dir);
  return { aborted: true };
};

export const removeProjectFile = async (id: string) => {
  const hosting = await Hosting.findById(id);
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');

  if (hosting.projectFile?.storedName) {
    const filePath = path.join(PROJECT_UPLOAD_DIR(), hosting.projectFile.storedName);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }

  hosting.projectFile = null;
  await hosting.save();
  return hosting.toObject() as IHosting;
};

// ============================================
// USER
// ============================================

export const getUserHostings = async (userId: string) => {
  const hostings = await Hosting.find({ userId: new mongoose.Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .lean();
  return hostings.map((h) => toCustomerHosting(h));
};

export const getUserHostingById = async (userId: string, id: string) => {
  const hosting = await Hosting.findOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');
  return toCustomerHosting(hosting);
};

export const getProjectDownloadPath = async (
  userId: string,
  id: string,
  isAdmin = false,
): Promise<{ absolutePath: string; downloadName: string }> => {
  const filter: Record<string, unknown> = { _id: id };
  if (!isAdmin) filter.userId = new mongoose.Types.ObjectId(userId);

  const hosting = await Hosting.findOne(filter).lean();
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');
  if (!hosting.projectFile?.storedName) {
    throw new AppError(httpStatus.NOT_FOUND, 'No project file available for download.');
  }

  const absolutePath = path.join(PROJECT_UPLOAD_DIR(), hosting.projectFile.storedName);
  if (!fs.existsSync(absolutePath)) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      'Project file is missing on the server. Re-upload the ZIP or mount a persistent uploads volume.',
    );
  }

  return {
    absolutePath,
    downloadName: hosting.projectFile.originalName || 'project.zip',
  };
};

type TDownloadTokenPayload = {
  hostingId: string;
  userId: string;
  purpose: 'hosting-project-download';
};

/** Short-lived token so the browser can stream large ZIPs natively (no JS blob). */
export const createProjectDownloadToken = async (
  userId: string,
  hostingId: string,
  isAdmin = false,
): Promise<{ token: string; expiresIn: number; downloadPath: string }> => {
  await getProjectDownloadPath(userId, hostingId, isAdmin);

  const expiresIn = 5 * 60; // 5 minutes
  const secret = config.jwt_access_secret;
  if (!secret) throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'JWT secret not configured.');

  const token = jwt.sign(
    {
      hostingId,
      userId,
      purpose: 'hosting-project-download',
    } satisfies TDownloadTokenPayload,
    secret,
    { expiresIn },
  );

  return {
    token,
    expiresIn,
    downloadPath: `/api/v1/hostings/download-file?token=${encodeURIComponent(token)}`,
  };
};

export const resolveProjectDownloadByToken = async (
  token: string,
): Promise<{ absolutePath: string; downloadName: string }> => {
  const secret = config.jwt_access_secret;
  if (!secret) throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'JWT secret not configured.');

  let payload: TDownloadTokenPayload;
  try {
    payload = jwt.verify(token, secret) as TDownloadTokenPayload;
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Download link expired or invalid. Please try again.');
  }

  if (payload.purpose !== 'hosting-project-download' || !payload.hostingId) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid download token.');
  }

  const hosting = await Hosting.findById(payload.hostingId).lean();
  if (!hosting?.projectFile?.storedName) {
    throw new AppError(httpStatus.NOT_FOUND, 'No project file available for download.');
  }

  const absolutePath = path.join(PROJECT_UPLOAD_DIR(), hosting.projectFile.storedName);
  if (!fs.existsSync(absolutePath)) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      'Project file is missing on the server. Re-upload the ZIP or mount a persistent uploads volume.',
    );
  }

  return {
    absolutePath,
    downloadName: hosting.projectFile.originalName || 'project.zip',
  };
};

// ============================================
// cPanel SSO + credential email
// ============================================

type TCpanelSsoPayload = {
  hostingId: string;
  userId: string;
  purpose: 'hosting-cpanel-sso';
  jti: string;
};

/** Short-lived one-use tokens (in-memory). Survives process restarts as expired JWTs. */
const usedCpanelSsoJtis = new Map<string, number>();
const cpanelEmailCooldown = new Map<string, number>(); // hostingId → lastSentAt ms

const pruneExpiredJtis = () => {
  const now = Date.now();
  for (const [jti, exp] of usedCpanelSsoJtis.entries()) {
    if (exp < now) usedCpanelSsoJtis.delete(jti);
  }
};

const loadOwnedHostingForCpanel = async (
  userId: string,
  hostingId: string,
  isAdmin = false,
) => {
  const filter: Record<string, unknown> = { _id: hostingId };
  if (!isAdmin) filter.userId = new mongoose.Types.ObjectId(userId);

  const hosting = await Hosting.findOne(filter).lean();
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');

  if (hosting.status !== 'active') {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'cPanel access is only available for active hosting plans.',
    );
  }

  if (!hasCompleteCpanelCredentials(hosting)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'cPanel credentials are not ready yet. Please contact support.',
    );
  }

  return hosting;
};

/** Create a short-lived SSO path the browser can open in a new tab. */
export const createCpanelLoginToken = async (
  userId: string,
  hostingId: string,
  isAdmin = false,
  publicOrigin?: string,
): Promise<{ ssoPath: string; ssoUrl: string; expiresIn: number }> => {
  await loadOwnedHostingForCpanel(userId, hostingId, isAdmin);

  const secret = config.jwt_access_secret;
  if (!secret) throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'JWT secret not configured.');

  const expiresIn = 60; // 60 seconds
  const jti = crypto.randomBytes(16).toString('hex');

  const token = jwt.sign(
    {
      hostingId,
      userId,
      purpose: 'hosting-cpanel-sso',
      jti,
    } satisfies TCpanelSsoPayload,
    secret,
    { expiresIn },
  );

  const ssoPath = `/api/v1/hostings/cpanel-sso?token=${encodeURIComponent(token)}`;
  const origin = (publicOrigin || process.env.BACKEND_PUBLIC_URL || process.env.API_PUBLIC_URL || '')
    .trim()
    .replace(/\/$/, '');
  const ssoUrl = origin ? `${origin}${ssoPath}` : ssoPath;

  return {
    expiresIn,
    ssoPath,
    ssoUrl,
  };
};

/** Resolve SSO token → one-time cPanel session URL (redirect the browser there). */
export const resolveCpanelSsoRedirect = async (token: string): Promise<string> => {
  const secret = config.jwt_access_secret;
  if (!secret) throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'JWT secret not configured.');

  let payload: TCpanelSsoPayload;
  try {
    payload = jwt.verify(token, secret) as TCpanelSsoPayload;
  } catch {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      'cPanel link expired or invalid. Please try again from My Hosting.',
    );
  }

  if (payload.purpose !== 'hosting-cpanel-sso' || !payload.hostingId || !payload.jti) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid cPanel login token.');
  }

  pruneExpiredJtis();
  if (usedCpanelSsoJtis.has(payload.jti)) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      'This cPanel link was already used. Please open cPanel again from My Hosting.',
    );
  }
  usedCpanelSsoJtis.set(payload.jti, Date.now() + 2 * 60 * 1000);

  const hosting = await Hosting.findById(payload.hostingId).lean();
  if (!hosting || !hasCompleteCpanelCredentials(hosting)) {
    usedCpanelSsoJtis.delete(payload.jti);
    throw new AppError(httpStatus.NOT_FOUND, 'cPanel credentials are not available.');
  }

  if (hosting.status !== 'active') {
    usedCpanelSsoJtis.delete(payload.jti);
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'cPanel access is only available for active hosting plans.',
    );
  }

  let password: string;
  try {
    password = decryptCredential(hosting.cpanelPassword as string);
  } catch {
    usedCpanelSsoJtis.delete(payload.jti);
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Unable to unlock cPanel credentials. Please contact support.',
    );
  }

  try {
    return await createCpanelOneTimeLoginUrl(
      hosting.cpanelUrl as string,
      hosting.cpanelUsername as string,
      password,
    );
  } catch (err) {
    usedCpanelSsoJtis.delete(payload.jti);
    throw err;
  }
};

/** Email cPanel credentials to the hosting owner. Rate-limited per hosting. */
export const sendCpanelAccessEmail = async (
  userId: string,
  hostingId: string,
  isAdmin = false,
): Promise<{ emailedTo: string }> => {
  const hosting = await loadOwnedHostingForCpanel(userId, hostingId, isAdmin);

  const cooldownMs = 2 * 60 * 1000;
  const lastSent = cpanelEmailCooldown.get(String(hosting._id)) || 0;
  const now = Date.now();
  if (now - lastSent < cooldownMs) {
    const waitSec = Math.ceil((cooldownMs - (now - lastSent)) / 1000);
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      `Please wait ${waitSec} seconds before requesting credentials again.`,
    );
  }

  const owner = await User.findById(hosting.userId).select('name email').lean();
  if (!owner?.email) {
    throw new AppError(httpStatus.BAD_REQUEST, 'No email address found on your account.');
  }

  let password: string;
  try {
    password = decryptCredential(hosting.cpanelPassword as string);
  } catch {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Unable to unlock cPanel credentials. Please contact support.',
    );
  }

  const cpanelUrl = (hosting.cpanelUrl as string).trim();
  const username = hosting.cpanelUsername as string;
  const domain = (hosting.cpanelDomain || hosting.websiteLabel || '—') as string;
  const customerName = owner.name || 'Customer';

  try {
    await sendEmail(
      owner.email,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
          <h2 style="color: #4F46E5; margin-bottom: 8px;">Your cPanel Access Details</h2>
          <p>Dear ${escapeHtml(customerName)},</p>
          <p>Here are the login details for your hosting plan <strong>${escapeHtml(hosting.planName)}</strong>.</p>
          <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
            <tr>
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: bold; width: 40%;">cPanel URL</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb;"><a href="${escapeHtml(cpanelUrl)}">${escapeHtml(cpanelUrl)}</a></td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: bold;">Username</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-family: monospace;">${escapeHtml(username)}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: bold;">Password</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-family: monospace;">${escapeHtml(password)}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: bold;">Domain</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb;">${escapeHtml(domain)}</td>
            </tr>
          </table>
          <p style="font-size: 14px; color: #64748b;">
            Keep these details private. You can also open cPanel directly from
            <a href="${process.env.FRONTEND_URL || ''}/my-account?tab=hosting">My Account → Hosting</a>.
          </p>
          <p>Thank you for choosing BIT Software &amp; IT Solution!</p>
        </div>
      `,
      `🔐 cPanel Access — ${hosting.planName} — BIT Software`,
    );
  } catch (err) {
    console.error('[Hosting] cPanel access email failed:', err);
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to send cPanel access email. Please try again shortly.',
    );
  }

  cpanelEmailCooldown.set(String(hosting._id), now);

  return { emailedTo: owner.email };
};
