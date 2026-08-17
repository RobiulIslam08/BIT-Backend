// ============================================
// BIT SOFTWARE — Visitor Activity Validation
// ============================================

import { z } from 'zod';

const idSchema = z
  .string({ message: 'ID is required' })
  .trim()
  .min(8, { message: 'ID is too short' })
  .max(80, { message: 'ID is too long' });

const pathSchema = z
  .string({ message: 'Path is required' })
  .trim()
  .min(1, { message: 'Path is required' })
  .max(500, { message: 'Path is too long' });

const pageViewValidationSchema = z.object({
  body: z.object({
    sessionId: idSchema,
    visitorId: idSchema,
    path: pathSchema,
    title: z.string().trim().max(300).optional(),
    referrer: z.string().trim().max(500).optional(),
    language: z.string().trim().max(32).optional(),
  }),
});

const heartbeatValidationSchema = z.object({
  body: z.object({
    sessionId: idSchema,
    visitorId: idSchema.optional(),
  }),
});

const leaveValidationSchema = z.object({
  body: z.object({
    sessionId: idSchema,
  }),
});

const eventValidationSchema = z.object({
  body: z.object({
    sessionId: idSchema,
    type: z.enum(['whatsapp']),
    path: pathSchema.optional(),
  }),
});

export const VisitorActivityValidation = {
  pageViewValidationSchema,
  heartbeatValidationSchema,
  leaveValidationSchema,
  eventValidationSchema,
};
