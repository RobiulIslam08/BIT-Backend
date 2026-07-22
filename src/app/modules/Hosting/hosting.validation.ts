// ============================================
// BIT SOFTWARE — Hosting Asset Validation
// ============================================

import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid id format' });

const statusEnum = z.enum(['active', 'pending', 'expired', 'suspended', 'cancelled']);
const planTypeEnum = z.enum(['shared', 'vps']);
const billingEnum = z.enum(['monthly', 'yearly']);

const createHostingValidationSchema = z.object({
  body: z.object({
    userId: objectId,
    planSlug: z.string().trim().toLowerCase().min(2).max(80).optional(),
    planName: z.string().trim().min(1).max(100),
    planType: planTypeEnum,
    billingCycle: billingEnum.optional(),
    features: z.array(z.string().trim().max(200)).max(30).optional(),
    websiteLabel: z.string().trim().max(253).optional(),
    status: statusEnum.optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    amountUSD: z.number().min(0).max(100000).optional(),
    renewPriceUSD: z.number().min(0).max(100000).optional(),
    hostingPlanId: objectId.optional(),
    notes: z.string().trim().max(2000).optional(),
    internalProvider: z.string().trim().max(100).optional(),
    internalServerNote: z.string().trim().max(2000).optional(),
  }),
});

const updateHostingValidationSchema = z.object({
  body: z.object({
    userId: objectId.optional(),
    planSlug: z.string().trim().toLowerCase().min(2).max(80).optional(),
    planName: z.string().trim().min(1).max(100).optional(),
    planType: planTypeEnum.optional(),
    billingCycle: billingEnum.optional(),
    features: z.array(z.string().trim().max(200)).max(30).optional(),
    websiteLabel: z.string().trim().max(253).optional(),
    status: statusEnum.optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    amountUSD: z.number().min(0).max(100000).optional(),
    renewPriceUSD: z.number().min(0).max(100000).optional(),
    notes: z.string().trim().max(2000).optional(),
    internalProvider: z.string().trim().max(100).optional(),
    internalServerNote: z.string().trim().max(2000).optional(),
  }),
});

export const HostingValidation = {
  createHostingValidationSchema,
  updateHostingValidationSchema,
};
