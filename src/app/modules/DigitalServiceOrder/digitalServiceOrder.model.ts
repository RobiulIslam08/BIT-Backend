// ============================================
// BIT SOFTWARE — Digital Service Order Model
// ============================================

import { Schema, model } from 'mongoose';
import { IDigitalServiceOrder } from './digitalServiceOrder.interface';
import {
  DIGITAL_PACKAGE_TYPES,
  DIGITAL_SERVICE_KEYS,
} from '../DigitalService/digitalService.catalog';

const DigitalServiceOrderSchema = new Schema<IDigitalServiceOrder>(
  {
    orderId: { type: String, unique: true, sparse: true, trim: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    serviceKey: {
      type: String,
      enum: DIGITAL_SERVICE_KEYS,
      required: true,
      index: true,
    },
    serviceName: { type: String, required: true, trim: true, maxlength: 120 },
    packageType: {
      type: String,
      enum: DIGITAL_PACKAGE_TYPES,
      required: true,
      index: true,
    },
    packageLabel: { type: String, required: true, trim: true, maxlength: 80 },
    durationDays: { type: Number, required: true, min: 1 },

    amountSAR: { type: Number, required: true, min: 0 },
    amountUSD: { type: Number, required: true, min: 0 },
    exchangeRateUsed: { type: Number, required: true, min: 0, default: 3.75 },

    paymentMethod: {
      type: String,
      enum: ['paypal', 'wallet'],
      required: true,
      default: 'paypal',
    },
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
    digitalServiceId: { type: Schema.Types.ObjectId, ref: 'DigitalService' },

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

DigitalServiceOrderSchema.index({ orderStatus: 1, paymentStatus: 1, createdAt: -1 });
DigitalServiceOrderSchema.index({ userId: 1, serviceKey: 1, packageType: 1 });
DigitalServiceOrderSchema.index(
  { abandonedAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 30,
    name: 'ttl_digital_service_abandoned_retention',
  },
);

// One fulfilled trial per user per service (paid + active/processing)
DigitalServiceOrderSchema.index(
  { userId: 1, serviceKey: 1, packageType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      packageType: 'trial',
      paymentStatus: 'paid',
      orderStatus: { $in: ['processing', 'active'] },
    },
    name: 'uniq_one_paid_trial_per_user_service',
  },
);

export const DigitalServiceOrder = model<IDigitalServiceOrder>(
  'DigitalServiceOrder',
  DigitalServiceOrderSchema,
);
