// ============================================
// BIT SOFTWARE — Business Email Order Model
// ============================================

import { Schema, model } from 'mongoose';
import { IEmailOrder } from './emailOrder.interface';

const EmailOrderSchema = new Schema<IEmailOrder>(
  {
    orderId: { type: String, unique: true, sparse: true, trim: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    planSlug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    planName: { type: String, required: true, trim: true, maxlength: 100 },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    features: { type: [String], default: [] },

    businessName: { type: String, required: true, trim: true, maxlength: 200 },
    country: { type: String, required: true, trim: true, maxlength: 100 },
    teamSize: { type: String, trim: true, maxlength: 50 },
    domainName: { type: String, required: true, trim: true, lowercase: true, maxlength: 253 },
    domainOwnership: {
      type: String,
      enum: ['i_have_domain', 'need_domain_help'],
    },
    adminFirstName: { type: String, required: true, trim: true, maxlength: 100 },
    adminLastName: { type: String, required: true, trim: true, maxlength: 100 },
    desiredEmailLocalPart: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 64,
    },
    recoveryEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^\S+@\S+\.\S+$/, 'Invalid recovery email'],
    },
    businessAddress: { type: String, trim: true, maxlength: 500 },

    sellPriceUSD: { type: Number, required: true, min: 0 },
    displayCurrency: {
      type: String,
      enum: ['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'],
      required: true,
      default: 'SAR',
    },
    displayAmount: { type: Number, required: true, min: 0 },
    exchangeRateUsed: { type: Number, required: true, min: 0 },

    paymentMethod: { type: String, enum: ['paypal', 'wallet'], required: true, default: 'paypal' },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
      index: true,
    },
    paypalOrderId: { type: String, unique: true, sparse: true, trim: true },
    paypalCaptureId: { type: String, unique: true, sparse: true, trim: true },
    paypalTransactionId: { type: String, unique: true, sparse: true, trim: true },
    paypalRefundId: { type: String, unique: true, sparse: true, trim: true },

    walletTransactionId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction' },
    walletPromoUsed: { type: Number, min: 0 },
    walletAccountUsed: { type: Number, min: 0 },

    orderStatus: {
      type: String,
      enum: ['pending_payment', 'processing', 'active', 'failed', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    failureReason: { type: String, trim: true, maxlength: 1000 },
    refundedAt: { type: Date },
    abandonedAt: { type: Date },

    startsAt: { type: Date },
    expiresAt: { type: Date },
    emailAssetId: { type: Schema.Types.ObjectId, ref: 'Email' },
    emailPlanId: { type: Schema.Types.ObjectId, ref: 'EmailPlan' },

    customerName: { type: String, required: true, trim: true, maxlength: 200 },
    customerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    customerPhone: { type: String, required: true, trim: true, maxlength: 30 },

    cartCheckoutId: { type: String, trim: true, index: true, sparse: true },
    idempotencyKey: { type: String, trim: true, maxlength: 80 },
  },
  { timestamps: true },
);

EmailOrderSchema.index({ orderStatus: 1, paymentStatus: 1, createdAt: -1 });
EmailOrderSchema.index({ userId: 1, orderStatus: 1, createdAt: -1 });
EmailOrderSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'uniq_email_idempotency_key' },
);
EmailOrderSchema.index(
  { walletTransactionId: 1 },
  { unique: true, sparse: true, name: 'uniq_email_wallet_txn' },
);
EmailOrderSchema.index(
  { abandonedAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 30,
    name: 'ttl_email_abandoned_retention',
  },
);

export const EmailOrder = model<IEmailOrder>('EmailOrder', EmailOrderSchema);
