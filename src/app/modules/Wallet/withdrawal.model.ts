// ============================================
// BIT SOFTWARE — Withdrawal Request Model
// ============================================
// Customer requests to withdraw (cash out) their withdrawable account balance.
// Funds are held (debited) when the request is created; on admin completion the
// money is considered sent, on rejection the held funds are returned.

import { Schema, model } from 'mongoose';
import { IWithdrawal } from './wallet.interface';

const WithdrawalSchema = new Schema<IWithdrawal>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amountUSD: { type: Number, required: true, min: 1 },
    method: {
      type: String,
      enum: ['bank', 'bkash', 'nagad', 'paypal'],
      required: true,
    },
    details: {
      bankName: { type: String, trim: true, maxlength: 200 },
      accountName: { type: String, trim: true, maxlength: 200 },
      accountNumber: { type: String, trim: true, maxlength: 100 },
      routingNumber: { type: String, trim: true, maxlength: 100 },
      branch: { type: String, trim: true, maxlength: 200 },
      walletNumber: { type: String, trim: true, maxlength: 50 },
      paypalEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'rejected'],
      default: 'pending',
      index: true,
    },
    walletTransactionId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction' },
    adminNote: { type: String, trim: true, maxlength: 1000 },
    payoutRef: { type: String, trim: true, maxlength: 200 },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

WithdrawalSchema.index({ userId: 1, createdAt: -1 });
WithdrawalSchema.index({ status: 1, createdAt: -1 });

export const Withdrawal = model<IWithdrawal>('Withdrawal', WithdrawalSchema);
