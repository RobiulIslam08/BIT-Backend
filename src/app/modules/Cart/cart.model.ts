// ============================================
// BIT SOFTWARE — Cart Checkout Model
// ============================================

import { Schema, model } from 'mongoose';
import { ICartCheckout } from './cart.interface';

const CartLineResultSchema = new Schema(
  {
    type: { type: String, enum: ['domain', 'hosting'], required: true },
    label: { type: String, required: true, trim: true },
    sellPriceUSD: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['active', 'failed', 'pending'], required: true },
    orderId: { type: String, trim: true },
    dbOrderId: { type: String, trim: true },
    failureReason: { type: String, trim: true, maxlength: 1000 },
    refundedUSD: { type: Number, min: 0 },
  },
  { _id: false },
);

const CartCheckoutSchema = new Schema<ICartCheckout>(
  {
    cartCheckoutId: { type: String, unique: true, sparse: true, trim: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

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
      enum: ['pending', 'paid', 'failed', 'partially_refunded', 'refunded'],
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

    status: {
      type: String,
      enum: ['pending_payment', 'processing', 'completed', 'partial', 'failed', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    failureReason: { type: String, trim: true, maxlength: 1000 },
    abandonedAt: { type: Date },

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

    domainOrderIds: [{ type: Schema.Types.ObjectId, ref: 'DomainOrder' }],
    hostingOrderIds: [{ type: Schema.Types.ObjectId, ref: 'HostingOrder' }],
    lineResults: { type: [CartLineResultSchema], default: [] },
  },
  { timestamps: true },
);

CartCheckoutSchema.index({ userId: 1, status: 1, createdAt: -1 });
CartCheckoutSchema.index(
  { abandonedAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 30,
    name: 'ttl_cart_abandoned_retention',
  },
);

export const CartCheckout = model<ICartCheckout>('CartCheckout', CartCheckoutSchema);
