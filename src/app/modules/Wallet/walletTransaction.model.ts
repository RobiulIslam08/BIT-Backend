// ============================================
// BIT SOFTWARE — Wallet Transaction (Ledger) Model
// ============================================
// Immutable audit trail of every balance change. The User's accountBalance
// and promotionalCredit are kept in sync by the wallet service, but this
// collection is the source of truth for "what happened and why".

import { Schema, model } from 'mongoose';
import { IWalletTransaction } from './wallet.interface';

const WalletTransactionSchema = new Schema<IWalletTransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'topup',
        'purchase',
        'refund',
        'bonus_credit',
        'withdrawal',
        'withdrawal_reversal',
        'adjustment',
      ],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'completed',
      index: true,
    },

    accountAmount: { type: Number, default: 0 },
    promoAmount: { type: Number, default: 0 },
    amount: { type: Number, required: true, min: 0 },

    grossUSD: { type: Number, min: 0 },
    feeUSD: { type: Number, min: 0 },
    netUSD: { type: Number, min: 0 },

    balanceAfterAccount: { type: Number },
    balanceAfterPromo: { type: Number },

    reference: {
      kind: {
        type: String,
        enum: [
          'domain_order',
          'hosting_order',
          'gmb_order',
          'domain_renewal',
          'paypal_topup',
          'withdrawal',
          'admin',
        ],
      },
      id: { type: String, trim: true },
    },

    paypalOrderId: { type: String, trim: true, unique: true, sparse: true },
    paypalCaptureId: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

WalletTransactionSchema.index({ userId: 1, createdAt: -1 });
WalletTransactionSchema.index({ type: 1, status: 1, createdAt: -1 });

export const WalletTransaction = model<IWalletTransaction>(
  'WalletTransaction',
  WalletTransactionSchema,
);
