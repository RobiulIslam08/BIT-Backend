// ============================================
// BIT SOFTWARE — Business Email Asset Validation
// ============================================

import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid id format' });
const statusEnum = z.enum(['active', 'pending', 'expired', 'suspended', 'cancelled']);
const billingEnum = z.enum(['monthly', 'yearly']);
const provisioningEnum = z.enum(['pending_setup', 'ready']);
const ownershipEnum = z.enum(['i_have_domain', 'need_domain_help']);

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .refine((v) => !v || /^https?:\/\/.+/i.test(v), {
    message: 'Webmail URL must start with http:// or https://',
  });

const createEmailValidationSchema = z.object({
  body: z.object({
    userId: objectId,
    planSlug: z.string().trim().toLowerCase().min(2).max(80).optional(),
    planName: z.string().trim().min(1).max(100),
    billingCycle: billingEnum.optional(),
    features: z.array(z.string().trim().max(200)).max(30).optional(),
    businessName: z.string().trim().max(200).optional(),
    country: z.string().trim().max(100).optional(),
    teamSize: z.string().trim().max(50).optional(),
    domainName: z.string().trim().max(253).optional(),
    domainOwnership: ownershipEnum.optional(),
    adminFirstName: z.string().trim().max(100).optional(),
    adminLastName: z.string().trim().max(100).optional(),
    desiredEmailLocalPart: z.string().trim().max(64).optional(),
    recoveryEmail: z.string().trim().email().max(254).optional(),
    businessAddress: z.string().trim().max(500).optional(),
    customerPhone: z.string().trim().max(30).optional(),
    status: statusEnum.optional(),
    provisioningStatus: provisioningEnum.optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    amountUSD: z.number().min(0).max(100000).optional(),
    renewPriceUSD: z.number().min(0).max(100000).optional(),
    emailPlanId: objectId.optional(),
    notes: z.string().trim().max(2000).optional(),
    internalProvider: z.string().trim().max(100).optional(),
    internalAccountNote: z.string().trim().max(2000).optional(),
    primaryEmail: z.string().trim().email().max(254).optional(),
    webmailUrl: optionalUrl,
    webmailUsername: z.string().trim().max(128).optional(),
    webmailPassword: z.string().max(256).optional(),
  }),
});

const updateEmailValidationSchema = z.object({
  body: z.object({
    userId: objectId.optional(),
    planSlug: z.string().trim().toLowerCase().min(2).max(80).optional(),
    planName: z.string().trim().min(1).max(100).optional(),
    billingCycle: billingEnum.optional(),
    features: z.array(z.string().trim().max(200)).max(30).optional(),
    businessName: z.string().trim().max(200).optional(),
    country: z.string().trim().max(100).optional(),
    teamSize: z.string().trim().max(50).optional(),
    domainName: z.string().trim().max(253).optional(),
    domainOwnership: ownershipEnum.optional(),
    adminFirstName: z.string().trim().max(100).optional(),
    adminLastName: z.string().trim().max(100).optional(),
    desiredEmailLocalPart: z.string().trim().max(64).optional(),
    recoveryEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
    businessAddress: z.string().trim().max(500).optional(),
    customerPhone: z.string().trim().max(30).optional(),
    status: statusEnum.optional(),
    provisioningStatus: provisioningEnum.optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    amountUSD: z.number().min(0).max(100000).optional(),
    renewPriceUSD: z.number().min(0).max(100000).optional(),
    notes: z.string().trim().max(2000).optional(),
    internalProvider: z.string().trim().max(100).optional(),
    internalAccountNote: z.string().trim().max(2000).optional(),
    primaryEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
    webmailUrl: optionalUrl.or(z.literal('')),
    webmailUsername: z.string().trim().max(128).optional(),
    webmailPassword: z.string().max(256).optional(),
  }),
});

export const EmailValidation = {
  createEmailValidationSchema,
  updateEmailValidationSchema,
};
