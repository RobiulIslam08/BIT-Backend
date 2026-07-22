// ============================================
// BIT SOFTWARE — Hosting Plan Service
// ============================================

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { HostingPlan } from './hostingPlan.model';
import {
  DEFAULT_HOSTING_PLANS,
  IHostingPlan,
} from './hostingPlan.interface';

/**
 * Seed default plans if the collection is empty.
 * Idempotent — safe to call on every startup / first read.
 */
export const seedHostingPlansIfEmpty = async (): Promise<number> => {
  const count = await HostingPlan.countDocuments();
  if (count > 0) return 0;

  await HostingPlan.insertMany(
    DEFAULT_HOSTING_PLANS.map((p) => ({ ...p, isActive: true })),
    { ordered: false },
  );
  console.log(`[HostingPlan] Seeded ${DEFAULT_HOSTING_PLANS.length} default plans.`);
  return DEFAULT_HOSTING_PLANS.length;
};

/** Public active plans for the marketing / checkout pages. */
export const getPublicPlans = async (planType?: string) => {
  await seedHostingPlansIfEmpty();

  const filter: Record<string, unknown> = { isActive: true };
  if (planType === 'shared' || planType === 'vps') filter.planType = planType;

  return HostingPlan.find(filter)
    .select('-notes -updatedBy -__v')
    .sort({ planType: 1, sortOrder: 1 })
    .lean();
};

/** Resolve an active plan by slug (purchase flow). */
export const getActivePlanBySlug = async (slug: string): Promise<IHostingPlan> => {
  await seedHostingPlansIfEmpty();
  const plan = await HostingPlan.findOne({
    slug: String(slug || '').toLowerCase().trim(),
    isActive: true,
  }).lean();
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, 'Hosting plan not found or inactive.');
  return plan as IHostingPlan;
};

export const getAllPlansAdmin = async (query: Record<string, unknown>) => {
  await seedHostingPlansIfEmpty();

  const filter: Record<string, unknown> = {};
  if (query.planType) filter.planType = query.planType;
  if (query.isActive !== undefined && query.isActive !== '') {
    filter.isActive = query.isActive === 'true' || query.isActive === true;
  }
  if (query.search) {
    const term = String(query.search).trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { slug: { $regex: term, $options: 'i' } },
    ];
  }

  return HostingPlan.find(filter).sort({ planType: 1, sortOrder: 1 }).lean();
};

export const createPlan = async (
  adminId: string,
  payload: Partial<IHostingPlan>,
): Promise<IHostingPlan> => {
  const slug = String(payload.slug || '').toLowerCase().trim();
  const existing = await HostingPlan.findOne({ slug });
  if (existing) {
    throw new AppError(httpStatus.CONFLICT, `Plan slug "${slug}" already exists.`);
  }

  const created = await HostingPlan.create({
    ...payload,
    slug,
    updatedBy: new mongoose.Types.ObjectId(adminId),
  });
  return created.toObject() as IHostingPlan;
};

export const updatePlan = async (
  id: string,
  adminId: string,
  payload: Partial<IHostingPlan>,
): Promise<IHostingPlan> => {
  const plan = await HostingPlan.findById(id);
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, 'Hosting plan not found.');

  if (payload.slug && payload.slug.toLowerCase() !== plan.slug) {
    const slug = payload.slug.toLowerCase().trim();
    const dup = await HostingPlan.findOne({ slug, _id: { $ne: plan._id } });
    if (dup) throw new AppError(httpStatus.CONFLICT, `Plan slug "${slug}" already exists.`);
    plan.slug = slug;
  }

  if (payload.name !== undefined) plan.name = payload.name;
  if (payload.planType !== undefined) plan.planType = payload.planType;
  if (payload.monthlyPriceUSD !== undefined) plan.monthlyPriceUSD = payload.monthlyPriceUSD;
  if (payload.yearlyPriceUSD !== undefined) plan.yearlyPriceUSD = payload.yearlyPriceUSD;
  if (payload.features !== undefined) plan.features = payload.features;
  if (payload.popular !== undefined) plan.popular = payload.popular;
  if (payload.isActive !== undefined) plan.isActive = payload.isActive;
  if (payload.sortOrder !== undefined) plan.sortOrder = payload.sortOrder;
  if (payload.notes !== undefined) plan.notes = payload.notes;
  plan.updatedBy = new mongoose.Types.ObjectId(adminId);

  await plan.save();
  return plan.toObject() as IHostingPlan;
};

export const deletePlan = async (id: string) => {
  const plan = await HostingPlan.findByIdAndDelete(id);
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, 'Hosting plan not found.');
  return { deleted: true };
};
