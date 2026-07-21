// ============================================
// BIT SOFTWARE — Domain Asset Validation (Zod)
// ============================================

import { z } from 'zod';

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid id format' });

const domainNameRegex = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const statusEnum = z.enum(['active', 'expired', 'pending', 'cancelled', 'transferred_out']);

// ─── Admin: create a domain asset (legacy or manual) ───
const createDomainValidationSchema = z.object({
  body: z.object({
    userId: objectId,
    domainName: z
      .string({ message: 'Domain name is required' })
      .trim()
      .toLowerCase()
      .regex(domainNameRegex, { message: 'Invalid domain name (e.g. example.com)' }),
    registrar: z.string().trim().max(100).optional(),
    managedByNamecheap: z.boolean().optional(),
    status: statusEnum.optional(),
    registeredAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    registrationYears: z.number().int().min(1).max(10).optional(),
    renewPriceUSD: z.number().min(0).max(100000).optional(),
    autoRenew: z.boolean().optional(),
    whoisPrivacy: z.boolean().optional(),
    nameservers: z.array(z.string().trim().max(253)).max(13).optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
});

// ─── Admin: update a domain asset ───
const updateDomainValidationSchema = z.object({
  body: z.object({
    userId: objectId.optional(),
    domainName: z
      .string()
      .trim()
      .toLowerCase()
      .regex(domainNameRegex, { message: 'Invalid domain name (e.g. example.com)' })
      .optional(),
    registrar: z.string().trim().max(100).optional(),
    managedByNamecheap: z.boolean().optional(),
    status: statusEnum.optional(),
    registeredAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
    registrationYears: z.number().int().min(1).max(10).optional(),
    renewPriceUSD: z.number().min(0).max(100000).optional(),
    autoRenew: z.boolean().optional(),
    whoisPrivacy: z.boolean().optional(),
    nameservers: z.array(z.string().trim().max(253)).max(13).optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
});

// ─── User: toggle auto-renew ───
const toggleAutoRenewValidationSchema = z.object({
  body: z.object({
    autoRenew: z.boolean({ message: 'autoRenew must be a boolean' }),
  }),
});

// ─── User: update nameservers ───
const updateNameserversValidationSchema = z.object({
  body: z.object({
    nameservers: z.array(z.string().trim().max(253)).max(13),
  }),
});

export const DomainValidation = {
  createDomainValidationSchema,
  updateDomainValidationSchema,
  toggleAutoRenewValidationSchema,
  updateNameserversValidationSchema,
};
