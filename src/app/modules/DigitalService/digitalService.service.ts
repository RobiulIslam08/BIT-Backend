// ============================================
// BIT SOFTWARE — Digital Service Asset Service
// ============================================

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { DigitalService } from './digitalService.model';
import { IDigitalService } from './digitalService.interface';
import { getPublicCatalog } from './digitalService.catalog';
import { hasUsedTrial } from '../DigitalServiceOrder/digitalServiceOrder.service';

/** Sync expired status when expiresAt has passed. */
const syncExpiry = async (docs: Record<string, any>[]) => {
  const now = new Date();
  const idsToExpire: string[] = [];

  const mapped = docs.map((doc) => {
    const out = { ...doc };
    if (
      out.status === 'active' &&
      out.expiresAt &&
      new Date(out.expiresAt) < now
    ) {
      out.status = 'expired';
      idsToExpire.push(String(out._id));
    }
    return out;
  });

  if (idsToExpire.length) {
    await DigitalService.updateMany(
      { _id: { $in: idsToExpire }, status: 'active' },
      { $set: { status: 'expired' } },
    );
  }

  return mapped;
};

export const toCustomerDigitalService = (doc: Record<string, any>) => {
  if (!doc) return doc;
  const { notes, assignedBy, __v, ...safe } = doc;
  return safe;
};

export const getCatalog = () => getPublicCatalog();

export const getTrialEligibility = async (userId: string, serviceKey: string) => {
  const used = await hasUsedTrial(userId, serviceKey as any);
  return { serviceKey, trialAvailable: !used };
};

export const getUserDigitalServices = async (userId: string) => {
  const docs = await DigitalService.find({
    userId: new mongoose.Types.ObjectId(userId),
  })
    .sort({ createdAt: -1 })
    .lean();
  const synced = await syncExpiry(docs);
  return synced.map(toCustomerDigitalService);
};

export const getUserDigitalServiceById = async (userId: string, id: string) => {
  const doc = await DigitalService.findOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();
  if (!doc) throw new AppError(httpStatus.NOT_FOUND, 'Service not found.');
  const [synced] = await syncExpiry([doc]);
  return toCustomerDigitalService(synced);
};

export const getAllDigitalServices = async (query: Record<string, unknown>) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.serviceKey) filter.serviceKey = query.serviceKey;
  if (query.packageType) filter.packageType = query.packageType;
  if (query.search) {
    const term = String(query.search).trim();
    filter.$or = [
      { serviceName: { $regex: term, $options: 'i' } },
      { packageLabel: { $regex: term, $options: 'i' } },
      { portalUrl: { $regex: term, $options: 'i' } },
    ];
  }

  const [docs, total] = await Promise.all([
    DigitalService.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email phone')
      .lean(),
    DigitalService.countDocuments(filter),
  ]);

  const synced = await syncExpiry(docs);

  return {
    services: synced,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getDigitalServiceByIdAdmin = async (id: string) => {
  const doc = await DigitalService.findById(id)
    .populate('userId', 'name email phone')
    .lean();
  if (!doc) throw new AppError(httpStatus.NOT_FOUND, 'Service not found.');
  const [synced] = await syncExpiry([doc]);
  return synced;
};

export const updateDigitalServiceAdmin = async (
  id: string,
  payload: {
    status?: string;
    portalUrl?: string;
    accessNotes?: string;
    notes?: string;
    startsAt?: string | Date;
    expiresAt?: string | Date;
    packageType?: string;
    packageLabel?: string;
  },
  adminId: string,
) => {
  const doc = await DigitalService.findById(id);
  if (!doc) throw new AppError(httpStatus.NOT_FOUND, 'Service not found.');

  const allowedStatus = ['active', 'pending', 'expired', 'suspended', 'cancelled'];
  if (payload.status !== undefined) {
    if (!allowedStatus.includes(payload.status)) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Invalid status.');
    }
    doc.status = payload.status as any;
  }
  if (payload.portalUrl !== undefined) doc.portalUrl = String(payload.portalUrl).trim();
  if (payload.accessNotes !== undefined) doc.accessNotes = String(payload.accessNotes).trim();
  if (payload.notes !== undefined) doc.notes = String(payload.notes).trim();
  if (payload.startsAt !== undefined) doc.startsAt = new Date(payload.startsAt);
  if (payload.expiresAt !== undefined) doc.expiresAt = new Date(payload.expiresAt);
  if (payload.packageLabel !== undefined) doc.packageLabel = String(payload.packageLabel).trim();

  doc.assignedBy = new mongoose.Types.ObjectId(adminId);
  await doc.save();
  return doc.toObject() as IDigitalService;
};
