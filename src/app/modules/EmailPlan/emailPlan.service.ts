// ============================================
// BIT SOFTWARE — Business Email Plan Service
// ============================================

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { EmailPlan } from './emailPlan.model';
import { DEFAULT_EMAIL_PLANS, IEmailPlan } from './emailPlan.interface';

export const seedEmailPlansIfEmpty = async (): Promise<number> => {
  const count = await EmailPlan.countDocuments();
  if (count > 0) return 0;

  await EmailPlan.insertMany(
    DEFAULT_EMAIL_PLANS.map((p) => ({ ...p, isActive: true })),
    { ordered: false },
  );
  console.log(`[EmailPlan] Seeded ${DEFAULT_EMAIL_PLANS.length} default plans.`);
  return DEFAULT_EMAIL_PLANS.length;
};

export const getPublicPlans = async () => {
  await seedEmailPlansIfEmpty();
  return EmailPlan.find({ isActive: true })
    .select('-notes -updatedBy -__v')
    .sort({ sortOrder: 1 })
    .lean();
};

export const getActivePlanBySlug = async (slug: string): Promise<IEmailPlan> => {
  await seedEmailPlansIfEmpty();
  const plan = await EmailPlan.findOne({
    slug: String(slug || '').toLowerCase().trim(),
    isActive: true,
  }).lean();
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, 'Email plan not found or inactive.');
  return plan as IEmailPlan;
};

export const getAllPlansAdmin = async (query: Record<string, unknown>) => {
  await seedEmailPlansIfEmpty();

  const filter: Record<string, unknown> = {};
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

  return EmailPlan.find(filter).sort({ sortOrder: 1 }).lean();
};

export const createPlan = async (
  adminId: string,
  payload: Partial<IEmailPlan>,
): Promise<IEmailPlan> => {
  const slug = String(payload.slug || '').toLowerCase().trim();
  const existing = await EmailPlan.findOne({ slug });
  if (existing) {
    throw new AppError(httpStatus.CONFLICT, `Plan slug "${slug}" already exists.`);
  }

  const created = await EmailPlan.create({
    ...payload,
    slug,
    updatedBy: new mongoose.Types.ObjectId(adminId),
  });
  return created.toObject() as IEmailPlan;
};

export const updatePlan = async (
  id: string,
  adminId: string,
  payload: Partial<IEmailPlan>,
): Promise<IEmailPlan> => {
  const plan = await EmailPlan.findById(id);
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, 'Email plan not found.');

  if (payload.slug && payload.slug.toLowerCase() !== plan.slug) {
    const slug = payload.slug.toLowerCase().trim();
    const dup = await EmailPlan.findOne({ slug, _id: { $ne: plan._id } });
    if (dup) throw new AppError(httpStatus.CONFLICT, `Plan slug "${slug}" already exists.`);
    plan.slug = slug;
  }

  if (payload.name !== undefined) plan.name = payload.name;
  if (payload.monthlyPriceUSD !== undefined) plan.monthlyPriceUSD = payload.monthlyPriceUSD;
  if (payload.yearlyPriceUSD !== undefined) plan.yearlyPriceUSD = payload.yearlyPriceUSD;
  if (payload.features !== undefined) plan.features = payload.features;
  if (payload.popular !== undefined) plan.popular = payload.popular;
  if (payload.isActive !== undefined) plan.isActive = payload.isActive;
  if (payload.sortOrder !== undefined) plan.sortOrder = payload.sortOrder;
  if (payload.notes !== undefined) plan.notes = payload.notes;
  plan.updatedBy = new mongoose.Types.ObjectId(adminId);

  await plan.save();
  return plan.toObject() as IEmailPlan;
};

export const deletePlan = async (id: string) => {
  const plan = await EmailPlan.findByIdAndDelete(id);
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, 'Email plan not found.');
  return { deleted: true };
};
