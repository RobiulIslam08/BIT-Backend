// ============================================
// BIT SOFTWARE — Hosting Order Model
// ============================================

import { Schema, model } from 'mongoose';
import { IHostingOrder } from './hostingOrder.interface';

const HostingOrderSchema = new Schema<IHostingOrder>(
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
    planType: { type: String, enum: ['shared', 'vps'], required: true },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    features: { type: [String], default: [] },
    websiteLabel: { type: String, trim: true, maxlength: 253 },

    sellPriceUSD: { type: Number, required: true, min: 0 },
    displayCurrency: {
      type: String,
      enum: ['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'],
      required: true,
      default: 'SAR',
    },
    displayAmount: { type: Number, required: true, min: 0 },
    exchangeRateUsed: { type: Number, required: true, min: 0 },

    paymentMethod: { type: String, enum: ['paypal'], required: true, default: 'paypal' },
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
    hostingAssetId: { type: Schema.Types.ObjectId, ref: 'Hosting' },
    hostingPlanId: { type: Schema.Types.ObjectId, ref: 'HostingPlan' },

    customerName: { type: String, required: true, trim: true, maxlength: 200 },
    customerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    customerPhone: { type: String, trim: true, maxlength: 30 },
  },
  { timestamps: true },
);

HostingOrderSchema.index({ orderStatus: 1, paymentStatus: 1, createdAt: -1 });
HostingOrderSchema.index({ userId: 1, orderStatus: 1, createdAt: -1 });
HostingOrderSchema.index(
  { abandonedAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 30,
    name: 'ttl_hosting_abandoned_retention',
  },
);

export const HostingOrder = model<IHostingOrder>('HostingOrder', HostingOrderSchema);
