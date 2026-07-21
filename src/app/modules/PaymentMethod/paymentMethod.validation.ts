// ============================================
// BIT SOFTWARE — Payment Method Validation
// ============================================

import { z } from 'zod';

const savePaymentMethodValidationSchema = z.object({
  body: z
    .object({
      setupToken: z.string().trim().min(10).max(200).optional(),
      vaultSetupToken: z.string().trim().min(10).max(200).optional(),
    })
    .refine((b) => !!(b.setupToken || b.vaultSetupToken), {
      message: 'setupToken is required',
    }),
});

export const PaymentMethodValidation = {
  savePaymentMethodValidationSchema,
};
