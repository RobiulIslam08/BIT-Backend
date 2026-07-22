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
import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { Hosting } from './hosting.model';
import { IHosting } from './hosting.interface';
import { User } from '../User/user.model';

const PROJECT_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'hosting-projects');

const ensureUploadDir = () => {
  if (!fs.existsSync(PROJECT_UPLOAD_DIR)) {
    fs.mkdirSync(PROJECT_UPLOAD_DIR, { recursive: true });
  }
};

/** Strip admin-only fields before sending to customers. */
export const toCustomerHosting = (doc: Record<string, any>) => {
  if (!doc) return doc;
  const {
    notes,
    internalProvider,
    internalServerNote,
    assignedBy,
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

  return safe;
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
    assignedBy: new mongoose.Types.ObjectId(adminId),
  });

  return created.toObject() as IHosting;
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
    hostings,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getHostingByIdAdmin = async (id: string) => {
  const hosting = await Hosting.findById(id)
    .populate('userId', 'name email phone')
    .populate('assignedBy', 'name email')
    .lean();
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');
  return hosting;
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

  await hosting.save();
  return hosting.toObject() as IHosting;
};

export const deleteHosting = async (id: string) => {
  const hosting = await Hosting.findById(id);
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');

  // Remove project file from disk if present
  if (hosting.projectFile?.storedName) {
    const filePath = path.join(PROJECT_UPLOAD_DIR, hosting.projectFile.storedName);
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
    const oldPath = path.join(PROJECT_UPLOAD_DIR, hosting.projectFile.storedName);
    try {
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch {
      /* ignore */
    }
  }

  const ext = path.extname(file.originalname).toLowerCase() || '.zip';
  const storedName = `${hosting._id}-${Date.now()}${ext}`;
  const dest = path.join(PROJECT_UPLOAD_DIR, storedName);

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

export const removeProjectFile = async (id: string) => {
  const hosting = await Hosting.findById(id);
  if (!hosting) throw new AppError(httpStatus.NOT_FOUND, 'Hosting not found.');

  if (hosting.projectFile?.storedName) {
    const filePath = path.join(PROJECT_UPLOAD_DIR, hosting.projectFile.storedName);
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

  const absolutePath = path.join(PROJECT_UPLOAD_DIR, hosting.projectFile.storedName);
  if (!fs.existsSync(absolutePath)) {
    throw new AppError(httpStatus.NOT_FOUND, 'Project file is missing on the server.');
  }

  return {
    absolutePath,
    downloadName: hosting.projectFile.originalName || 'project.zip',
  };
};
