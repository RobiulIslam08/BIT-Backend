// ============================================
// BIT SOFTWARE — Cart Checkout Validation
// ============================================

import { z } from 'zod';

const blankToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const domainItem = z.object({
  type: z.literal('domain'),
  domainName: z.string().trim().min(3).max(253),
});

const hostingItem = z.object({
  type: z.literal('hosting'),
  planSlug: z.string().trim().min(1).max(80),
  billingCycle: z.enum(['monthly', 'yearly']),
  websiteLabel: z.preprocess(blankToUndefined, z.string().trim().max(253).optional()),
  attachedDomain: z.preprocess(blankToUndefined, z.string().trim().max(253).optional()),
});

const cartItem = z.discriminatedUnion('type', [domainItem, hostingItem]);

const createPayPalOrder = z.object({
  body: z.object({
    displayCurrency: z
      .enum(['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'])
      .optional()
      .default('SAR'),
    customerName: z.string().trim().min(1).max(200),
    customerEmail: z.string().trim().email().max(254),
    customerPhone: z.preprocess(blankToUndefined, z.string().trim().max(30).optional()),
    items: z.array(cartItem).min(1).max(20),
  }),
});

const completePurchase = z.object({
  body: z.object({
    paypalOrderId: z.string().trim().min(1),
  }),
});

const payWithWallet = z.object({
  body: z.object({
    displayCurrency: z
      .enum(['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'])
      .optional()
      .default('SAR'),
    customerName: z.string().trim().min(1).max(200),
    customerEmail: z.string().trim().email().max(254),
    customerPhone: z.preprocess(blankToUndefined, z.string().trim().max(30).optional()),
    items: z.array(cartItem).min(1).max(20),
  }),
});

export const CartValidation = {
  createPayPalOrder,
  completePurchase,
  payWithWallet,
};
