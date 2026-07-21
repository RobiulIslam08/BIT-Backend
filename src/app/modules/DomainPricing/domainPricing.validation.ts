// ============================================
// BIT SOFTWARE — Domain Pricing Validation
// ============================================

import { z } from 'zod';

const tldSchema = z
  .string({ message: 'TLD is required' })
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^\./, ''))
  .refine((v) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(v), {
    message: 'Invalid TLD (e.g. com, net, co.uk)',
  });

const priceSchema = z.number({ message: 'Price must be a number' }).min(0).max(100000);

const createDomainPricingValidationSchema = z.object({
  body: z.object({
    tld: tldSchema,
    registerPriceUSD: priceSchema,
    transferPriceUSD: priceSchema.optional(),
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(500).optional(),
  }),
});

const updateDomainPricingValidationSchema = z.object({
  body: z.object({
    registerPriceUSD: priceSchema.optional(),
    transferPriceUSD: priceSchema.optional(),
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(500).optional().nullable(),
  }).refine(
    (b) =>
      b.registerPriceUSD !== undefined ||
      b.transferPriceUSD !== undefined ||
      b.isActive !== undefined ||
      b.notes !== undefined,
    { message: 'At least one field is required to update.' },
  ),
});

const bulkUpdateDomainPricingValidationSchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          tld: tldSchema,
          registerPriceUSD: priceSchema,
          transferPriceUSD: priceSchema.optional(),
          isActive: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(100),
  }),
});

export const DomainPricingValidation = {
  createDomainPricingValidationSchema,
  updateDomainPricingValidationSchema,
  bulkUpdateDomainPricingValidationSchema,
};
