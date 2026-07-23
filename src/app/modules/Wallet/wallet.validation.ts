// ============================================
// BIT SOFTWARE — Wallet Validation (Zod)
// ============================================

import { z } from 'zod';

/** Treat blank strings as undefined so optional email/fields don't fail. */
const blankToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const optionalStr = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

const createTopupOrder = z.object({
  body: z.object({
    amountUSD: z.coerce
      .number({ message: 'amountUSD must be a number' })
      .positive('Top-up amount must be greater than zero'),
  }),
});

const completeTopup = z.object({
  body: z.object({
    paypalOrderId: z.string({ message: 'paypalOrderId is required' }).trim().min(1),
  }),
});

const withdrawalDetails = z
  .object({
    bankName: optionalStr(200),
    accountName: optionalStr(200),
    accountNumber: optionalStr(100),
    routingNumber: optionalStr(100),
    branch: optionalStr(200),
    walletNumber: optionalStr(50),
    paypalEmail: z.preprocess(
      blankToUndefined,
      z.string().trim().email('Invalid PayPal email').max(254).optional(),
    ),
  })
  .default({});

const createWithdrawal = z.object({
  body: z.object({
    amountUSD: z.coerce
      .number({ message: 'amountUSD must be a number' })
      .int('Withdrawals must be whole USD amounts')
      .positive('Withdrawal amount must be greater than zero'),
    method: z.enum(['bank', 'bkash', 'nagad', 'paypal'], {
      message: 'Invalid withdrawal method',
    }),
    details: withdrawalDetails,
  }),
});

// ─── Admin ───
const updateSettings = z.object({
  body: z.object({
    topupFeePercent: z.coerce.number().min(0).max(100).optional(),
    minTopupUSD: z.coerce.number().min(1, 'Minimum top-up must be at least $1').optional(),
  }),
});

const grantCredit = z.object({
  body: z
    .object({
      target: z.literal('all').optional(),
      userId: z.string().trim().optional(),
      userIds: z.array(z.string().trim()).optional(),
      amountUSD: z.coerce
        .number({ message: 'amountUSD must be a number' })
        .positive('Grant amount must be greater than zero'),
      note: z.string().trim().max(1000).optional(),
    })
    .refine(
      (data) => data.target === 'all' || !!data.userId || (data.userIds && data.userIds.length > 0),
      { message: 'Specify a target: userId, userIds, or "all".' },
    ),
});

const adjustBalance = z.object({
  body: z
    .object({
      userId: z.string({ message: 'userId is required' }).trim().min(1),
      accountDelta: z.coerce.number().optional(),
      promoDelta: z.coerce.number().optional(),
      note: z.string().trim().max(1000).optional(),
    })
    .refine(
      (data) => (data.accountDelta ?? 0) !== 0 || (data.promoDelta ?? 0) !== 0,
      { message: 'Provide a non-zero accountDelta or promoDelta.' },
    ),
});

const processWithdrawal = z.object({
  body: z.object({
    action: z.enum(['complete', 'reject'], { message: 'action must be complete or reject' }),
    payoutRef: z.string().trim().max(200).optional(),
    adminNote: z.string().trim().max(1000).optional(),
  }),
});

export const WalletValidation = {
  createTopupOrder,
  completeTopup,
  createWithdrawal,
  updateSettings,
  grantCredit,
  adjustBalance,
  processWithdrawal,
};
