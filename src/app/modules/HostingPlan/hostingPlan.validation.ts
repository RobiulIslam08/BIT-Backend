// ============================================
// BIT SOFTWARE — Hosting Plan Validation
// ============================================

import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid id format' });

const createPlanValidationSchema = z.object({
  body: z.object({
    slug: z
      .string({ message: 'slug is required' })
      .trim()
      .toLowerCase()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be kebab-case' }),
    name: z.string({ message: 'name is required' }).trim().min(1).max(100),
    planType: z.enum(['shared', 'vps']),
    monthlyPriceUSD: z.number().min(0).max(100000),
    yearlyPriceUSD: z.number().min(0).max(100000),
    features: z.array(z.string().trim().max(200)).max(30).optional(),
    popular: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
});

const updatePlanValidationSchema = z.object({
  body: z.object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be kebab-case' })
      .optional(),
    name: z.string().trim().min(1).max(100).optional(),
    planType: z.enum(['shared', 'vps']).optional(),
    monthlyPriceUSD: z.number().min(0).max(100000).optional(),
    yearlyPriceUSD: z.number().min(0).max(100000).optional(),
    features: z.array(z.string().trim().max(200)).max(30).optional(),
    popular: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
});

export const HostingPlanValidation = {
  createPlanValidationSchema,
  updatePlanValidationSchema,
  objectId,
};
