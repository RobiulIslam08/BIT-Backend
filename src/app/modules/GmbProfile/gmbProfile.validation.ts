// ============================================
// BIT SOFTWARE — GMB Profile Asset Validation
// ============================================

import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid id format' });

const statusEnum = z.enum(['pending', 'in_progress', 'active', 'suspended', 'cancelled']);
const serviceTypeEnum = z.enum(['new', 'recovery', 'regular']);
const locationEnum = z.enum(['yes', 'no']);

const dayHoursSchema = z.object({
  active: z.boolean(),
  open: z.string().trim().max(10),
  close: z.string().trim().max(10),
});

const businessHoursSchema = z.record(z.string().max(10), dayHoursSchema).optional();

const createGmbProfileValidationSchema = z.object({
  body: z.object({
    userId: objectId,
    businessName: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(200),
    hasPhysicalLocation: locationEnum,
    streetAddress: z.string().trim().max(500).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
    country: z.string().trim().max(100).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    serviceAreas: z.string().trim().max(1000).optional(),
    phone: z.string().trim().min(1).max(30),
    whatsapp: z.string().trim().max(30).optional(),
    email: z.string().trim().email().max(254),
    website: z.string().trim().max(500).optional(),
    description: z.string().trim().max(5000).optional(),
    servicesList: z.string().trim().max(5000).optional(),
    businessHours: businessHoursSchema,
    serviceType: serviceTypeEnum,
    status: statusEnum.optional(),
    startsAt: z.coerce.date().optional(),
    googleProfileUrl: z.string().trim().max(1000).optional(),
    placeId: z.string().trim().max(200).optional(),
    amountSAR: z.number().min(0).max(100000).optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
});

const updateGmbProfileValidationSchema = z.object({
  body: z.object({
    userId: objectId.optional(),
    businessName: z.string().trim().min(1).max(200).optional(),
    category: z.string().trim().min(1).max(200).optional(),
    hasPhysicalLocation: locationEnum.optional(),
    streetAddress: z.string().trim().max(500).optional().nullable(),
    city: z.string().trim().max(100).optional().nullable(),
    state: z.string().trim().max(100).optional().nullable(),
    postalCode: z.string().trim().max(20).optional().nullable(),
    country: z.string().trim().max(100).optional().nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    serviceAreas: z.string().trim().max(1000).optional().nullable(),
    phone: z.string().trim().min(1).max(30).optional(),
    whatsapp: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().email().max(254).optional(),
    website: z.string().trim().max(500).optional().nullable(),
    description: z.string().trim().max(5000).optional().nullable(),
    servicesList: z.string().trim().max(5000).optional().nullable(),
    businessHours: businessHoursSchema.nullable(),
    serviceType: serviceTypeEnum.optional(),
    status: statusEnum.optional(),
    startsAt: z.coerce.date().optional().nullable(),
    googleProfileUrl: z.string().trim().max(1000).optional().nullable(),
    placeId: z.string().trim().max(200).optional().nullable(),
    amountSAR: z.number().min(0).max(100000).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }),
});

export const GmbProfileValidation = {
  createGmbProfileValidationSchema,
  updateGmbProfileValidationSchema,
};
