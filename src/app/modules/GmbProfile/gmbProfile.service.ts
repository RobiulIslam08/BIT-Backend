// ============================================
// BIT SOFTWARE — GMB Profile Asset Service
// ============================================

import httpStatus from 'http-status';
import mongoose from 'mongoose';
import AppError from '../../errors/AppError';
import { User } from '../User/user.model';
import { GmbProfile } from './gmbProfile.model';
import {
  IGmbProfile,
  TBusinessHours,
  TGmbProfileStatus,
} from './gmbProfile.interface';

const ORDER_STATUS_TO_PROFILE: Record<string, TGmbProfileStatus> = {
  pending_review: 'pending',
  in_progress: 'in_progress',
  completed: 'active',
  cancelled: 'cancelled',
};

/** Normalize businessHours from FormData JSON / Map / plain object. */
export const normalizeBusinessHours = (raw: unknown): TBusinessHours | undefined => {
  if (raw == null || raw === '') return undefined;

  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  if (value instanceof Map) {
    value = Object.fromEntries(value.entries());
  }

  if (typeof value !== 'object' || Array.isArray(value)) return undefined;

  const out: TBusinessHours = {};
  for (const [day, hours] of Object.entries(value as Record<string, unknown>)) {
    if (!hours || typeof hours !== 'object') continue;
    const h = hours as Record<string, unknown>;
    out[String(day).slice(0, 10)] = {
      active: Boolean(h.active),
      open: String(h.open ?? '09:00').slice(0, 10),
      close: String(h.close ?? '18:00').slice(0, 10),
    };
  }
  return Object.keys(out).length ? out : undefined;
};

const hoursToPlain = (hours: unknown): TBusinessHours | undefined => {
  if (!hours) return undefined;
  if (hours instanceof Map) return Object.fromEntries(hours.entries()) as TBusinessHours;
  if (typeof hours === 'object') return hours as TBusinessHours;
  return undefined;
};

/** Strip admin-only fields before sending to customers. */
export const toCustomerGmbProfile = (doc: Record<string, any>) => {
  if (!doc) return doc;
  const { notes, assignedBy, __v, ...safe } = doc;
  safe.businessHours = hoursToPlain(safe.businessHours);
  return safe;
};

const toAdminGmbProfile = (doc: Record<string, any>) => {
  if (!doc) return doc;
  const out = { ...doc };
  out.businessHours = hoursToPlain(out.businessHours);
  return out;
};

const pickOrderSnapshot = (order: Record<string, any>) => ({
  businessName: String(order.businessName || '').trim(),
  category: String(order.category || '').trim() || 'Business',
  hasPhysicalLocation: order.hasPhysicalLocation === 'no' ? 'no' : 'yes',
  streetAddress: order.streetAddress,
  city: order.city,
  state: order.state,
  postalCode: order.postalCode,
  country: order.country,
  latitude: order.latitude,
  longitude: order.longitude,
  serviceAreas: order.serviceAreas,
  phone: String(order.phone || '').trim(),
  whatsapp: order.whatsapp,
  email: String(order.email || '').trim().toLowerCase(),
  website: order.website,
  description: order.description,
  servicesList: order.servicesList,
  businessHours: normalizeBusinessHours(order.businessHours),
  serviceType: ['new', 'recovery', 'regular'].includes(order.serviceType)
    ? order.serviceType
    : 'new',
  amountSAR: typeof order.finalAmount === 'number' ? order.finalAmount : undefined,
});

/**
 * Create (or return existing) profile from a saved GmbOrder.
 * Idempotent on gmbOrderId. Requires order.userId.
 */
export const createFromOrder = async (
  order: Record<string, any>,
  options?: { session?: mongoose.ClientSession },
): Promise<IGmbProfile | null> => {
  const orderId = order._id;
  const userId = order.userId;
  if (!orderId || !userId) return null;

  const existing = await GmbProfile.findOne({ gmbOrderId: orderId })
    .session(options?.session || null)
    .lean();
  if (existing) return toCustomerGmbProfile(existing) as IGmbProfile;

  const snapshot = pickOrderSnapshot(order);
  if (!snapshot.businessName || !snapshot.phone || !snapshot.email) {
    console.error('[GmbProfile] Cannot provision — missing required business fields', orderId);
    return null;
  }

  const status =
    ORDER_STATUS_TO_PROFILE[String(order.orderStatus)] || ('pending' as TGmbProfileStatus);

  const docs = [
    {
      userId: new mongoose.Types.ObjectId(String(userId)),
      ...snapshot,
      source: 'purchase',
      status,
      startsAt: status === 'active' ? new Date() : undefined,
      gmbOrderId: new mongoose.Types.ObjectId(String(orderId)),
    },
  ];

  const createdList = options?.session
    ? await GmbProfile.create(docs, { session: options.session })
    : await GmbProfile.create(docs);
  const created = Array.isArray(createdList) ? createdList[0] : createdList;

  // Best-effort back-link on order (caller may also set this)
  try {
    const { GmbOrder } = await import('../GmbOrder/gmbOrder.model');
    await GmbOrder.findByIdAndUpdate(
      orderId,
      { $set: { gmbProfileId: created._id } },
      options?.session ? { session: options.session } : undefined,
    );
  } catch (err) {
    console.error('[GmbProfile] Failed to back-link gmbProfileId on order', orderId, err);
  }

  return toCustomerGmbProfile(created.toObject()) as IGmbProfile;
};

/** Sync profile status (and optional userId) from order status changes. */
export const syncFromOrder = async (order: Record<string, any>): Promise<IGmbProfile | null> => {
  if (!order?._id) return null;

  let profile = await GmbProfile.findOne({ gmbOrderId: order._id });

  // Guest order later assigned a userId → provision now
  if (!profile && order.userId) {
    return createFromOrder(order);
  }
  if (!profile) return null;

  const nextStatus = ORDER_STATUS_TO_PROFILE[String(order.orderStatus)];
  const updates: Record<string, unknown> = {};

  if (nextStatus && profile.status !== nextStatus) {
    updates.status = nextStatus;
    if (nextStatus === 'active' && !profile.startsAt) {
      updates.startsAt = new Date();
    }
  }

  if (order.userId && String(profile.userId) !== String(order.userId)) {
    updates.userId = new mongoose.Types.ObjectId(String(order.userId));
  }

  // Keep business snapshot in sync when admin edits order info
  const snapshot = pickOrderSnapshot(order);
  Object.assign(updates, {
    businessName: snapshot.businessName,
    category: snapshot.category,
    hasPhysicalLocation: snapshot.hasPhysicalLocation,
    streetAddress: snapshot.streetAddress,
    city: snapshot.city,
    state: snapshot.state,
    postalCode: snapshot.postalCode,
    country: snapshot.country,
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    serviceAreas: snapshot.serviceAreas,
    phone: snapshot.phone,
    whatsapp: snapshot.whatsapp,
    email: snapshot.email,
    website: snapshot.website,
    description: snapshot.description,
    servicesList: snapshot.servicesList,
    serviceType: snapshot.serviceType,
  });
  if (snapshot.businessHours) updates.businessHours = snapshot.businessHours;
  if (snapshot.amountSAR != null) updates.amountSAR = snapshot.amountSAR;

  if (Object.keys(updates).length === 0) {
    return toAdminGmbProfile(profile.toObject()) as IGmbProfile;
  }

  Object.assign(profile, updates);
  await profile.save();
  return toAdminGmbProfile(profile.toObject()) as IGmbProfile;
};

// ============================================
// ADMIN
// ============================================

export const createGmbProfile = async (
  adminId: string,
  payload: Partial<IGmbProfile> & {
    userId: string;
    businessName: string;
    category: string;
    phone: string;
    email: string;
    serviceType: IGmbProfile['serviceType'];
    hasPhysicalLocation: 'yes' | 'no';
  },
): Promise<IGmbProfile> => {
  const owner = await User.findById(payload.userId);
  if (!owner) throw new AppError(httpStatus.NOT_FOUND, 'Selected user was not found.');

  const status = payload.status ?? 'active';
  const created = await GmbProfile.create({
    userId: new mongoose.Types.ObjectId(payload.userId),
    businessName: payload.businessName.trim(),
    category: payload.category.trim(),
    hasPhysicalLocation: payload.hasPhysicalLocation,
    streetAddress: payload.streetAddress?.trim(),
    city: payload.city?.trim(),
    state: payload.state?.trim(),
    postalCode: payload.postalCode?.trim(),
    country: payload.country?.trim(),
    latitude: payload.latitude,
    longitude: payload.longitude,
    serviceAreas: payload.serviceAreas?.trim(),
    phone: payload.phone.trim(),
    whatsapp: payload.whatsapp?.trim(),
    email: payload.email.trim().toLowerCase(),
    website: payload.website?.trim(),
    description: payload.description?.trim(),
    servicesList: payload.servicesList?.trim(),
    businessHours: normalizeBusinessHours(payload.businessHours),
    serviceType: payload.serviceType,
    source: 'admin_assigned',
    status,
    startsAt: payload.startsAt ? new Date(payload.startsAt) : status === 'active' ? new Date() : undefined,
    googleProfileUrl: payload.googleProfileUrl?.trim(),
    placeId: payload.placeId?.trim(),
    amountSAR: payload.amountSAR,
    notes: payload.notes,
    assignedBy: new mongoose.Types.ObjectId(adminId),
  });

  return toAdminGmbProfile(created.toObject()) as IGmbProfile;
};

export const getAllGmbProfiles = async (query: Record<string, unknown>) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.serviceType) filter.serviceType = query.serviceType;
  if (query.userId && mongoose.Types.ObjectId.isValid(String(query.userId))) {
    filter.userId = new mongoose.Types.ObjectId(String(query.userId));
  }
  if (query.search) {
    const term = String(query.search).trim();
    filter.$or = [
      { businessName: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
      { phone: { $regex: term, $options: 'i' } },
      { category: { $regex: term, $options: 'i' } },
    ];
  }

  const [total, profiles] = await Promise.all([
    GmbProfile.countDocuments(filter),
    GmbProfile.find(filter)
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return {
    profiles: profiles.map((p) => toAdminGmbProfile(p)),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

export const getGmbProfileByIdAdmin = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid profile ID format.');
  }
  const profile = await GmbProfile.findById(id)
    .populate('userId', 'name email phone')
    .populate('gmbOrderId', 'orderId orderStatus paymentStatus')
    .lean();
  if (!profile) throw new AppError(httpStatus.NOT_FOUND, 'GMB profile not found.');
  return toAdminGmbProfile(profile);
};

export const updateGmbProfile = async (
  id: string,
  payload: Partial<IGmbProfile> & { userId?: string },
): Promise<IGmbProfile> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid profile ID format.');
  }

  const profile = await GmbProfile.findById(id);
  if (!profile) throw new AppError(httpStatus.NOT_FOUND, 'GMB profile not found.');

  const allowed: Array<keyof IGmbProfile | 'userId'> = [
    'businessName',
    'category',
    'hasPhysicalLocation',
    'streetAddress',
    'city',
    'state',
    'postalCode',
    'country',
    'latitude',
    'longitude',
    'serviceAreas',
    'phone',
    'whatsapp',
    'email',
    'website',
    'description',
    'servicesList',
    'businessHours',
    'serviceType',
    'status',
    'startsAt',
    'googleProfileUrl',
    'placeId',
    'amountSAR',
    'notes',
    'userId',
  ];

  for (const key of allowed) {
    if (!(key in payload)) continue;
    const val = (payload as any)[key];
    if (key === 'userId') {
      if (!val || !mongoose.Types.ObjectId.isValid(String(val))) {
        throw new AppError(httpStatus.BAD_REQUEST, 'Invalid user id.');
      }
      const owner = await User.findById(val);
      if (!owner) throw new AppError(httpStatus.NOT_FOUND, 'Selected user was not found.');
      profile.userId = new mongoose.Types.ObjectId(String(val));
      continue;
    }
    if (key === 'businessHours') {
      (profile as any).businessHours = normalizeBusinessHours(val) ?? undefined;
      continue;
    }
    if (key === 'email' && typeof val === 'string') {
      profile.email = val.trim().toLowerCase();
      continue;
    }
    if (key === 'startsAt') {
      profile.startsAt = val ? new Date(val as Date) : undefined;
      continue;
    }
    (profile as any)[key] = val;
  }

  if (payload.status === 'active' && !profile.startsAt) {
    profile.startsAt = new Date();
  }

  await profile.save();
  return toAdminGmbProfile(profile.toObject()) as IGmbProfile;
};

export const deleteGmbProfile = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid profile ID format.');
  }
  const profile = await GmbProfile.findByIdAndDelete(id);
  if (!profile) throw new AppError(httpStatus.NOT_FOUND, 'GMB profile not found.');

  // Clear back-link on order if present
  if (profile.gmbOrderId) {
    try {
      const { GmbOrder } = await import('../GmbOrder/gmbOrder.model');
      await GmbOrder.findByIdAndUpdate(profile.gmbOrderId, { $unset: { gmbProfileId: 1 } });
    } catch {
      /* ignore */
    }
  }

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

// ============================================
// USER
// ============================================

export const getUserGmbProfiles = async (userId: string) => {
  const profiles = await GmbProfile.find({ userId: new mongoose.Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .lean();
  return profiles.map((p) => toCustomerGmbProfile(p));
};

export const getUserGmbProfileById = async (userId: string, id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid profile ID format.');
  }
  const profile = await GmbProfile.findOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();
  if (!profile) throw new AppError(httpStatus.NOT_FOUND, 'GMB profile not found.');
  return toCustomerGmbProfile(profile);
};
