// ============================================
// BIT SOFTWARE — Domain Order Mongoose Model
// ============================================

import { Schema, model } from 'mongoose';
import { IDomainOrder } from './domainOrder.interface';

const DomainOrderSchema = new Schema<IDomainOrder>(
  {
    // ─── Order Identity ───
    orderId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ─── Domain Info ───
    domainName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 253,
    },
    sld: { type: String, required: true, trim: true, lowercase: true, maxlength: 63 },
    tld: { type: String, required: true, trim: true, lowercase: true, maxlength: 63 },
    registrationYears: { type: Number, default: 1, min: 1, max: 10 },
    whoisPrivacy: { type: Boolean, default: true },

    // ─── Pricing ───
    sellPriceUSD: { type: Number, required: true, min: 0 },
    displayCurrency: {
      type: String,
      enum: ['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'],
      required: true,
      default: 'SAR',
    },
    displayAmount: { type: Number, required: true, min: 0 },
    exchangeRateUsed: { type: Number, required: true, min: 0 }, // audit trail

    // ─── Payment ───
    paymentMethod: {
      type: String,
      enum: ['paypal'],
      required: true,
      default: 'paypal',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
      index: true,
    },
    // sparse: true → allows multiple documents with null values (pending orders)
    paypalOrderId: { type: String, unique: true, sparse: true, trim: true },
    paypalCaptureId: { type: String, unique: true, sparse: true, trim: true },
    paypalTransactionId: { type: String, unique: true, sparse: true, trim: true },
    paypalRefundId: { type: String, unique: true, sparse: true, trim: true },

    // ─── Order Status ───
    orderStatus: {
      type: String,
      enum: ['pending_payment', 'processing', 'active', 'failed', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    failureReason: { type: String, trim: true, maxlength: 1000 },
    refundedAt: { type: Date },
    // Set when an unpaid checkout is auto-cancelled as abandoned. Drives TTL cleanup.
    abandonedAt: { type: Date },

    // ─── Namecheap Registration ───
    namecheapOrderId: { type: String, trim: true },
    registeredAt: { type: Date },
    expiresAt: { type: Date, index: true }, // for expiry queries

    // ─── Customer Contact ───
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
  {
    timestamps: true,
  },
);

// ─── Compound Indexes ───
// Prevent same user buying same domain twice (active)
DomainOrderSchema.index({ domainName: 1, orderStatus: 1 });
// Admin filters
DomainOrderSchema.index({ orderStatus: 1, paymentStatus: 1, createdAt: -1 });
// User's domain list
DomainOrderSchema.index({ userId: 1, orderStatus: 1, createdAt: -1 });
// Expiry monitoring
DomainOrderSchema.index({ expiresAt: 1, orderStatus: 1 });

// ─── TTL: retention cleanup for abandoned checkouts ───
// Abandoned unpaid checkouts are first gracefully cancelled by the sweeper
// (orderStatus → 'cancelled', abandonedAt set) so we keep a short audit trail
// (conversion/abandonment analytics). This TTL then permanently removes them
// 30 days after they were abandoned. Only documents that have `abandonedAt`
// set are affected — real (admin-cancelled/active/etc.) orders lack this field
// and are never touched by TTL.
DomainOrderSchema.index(
  { abandonedAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 30, // 30 days retention
    name: 'ttl_abandoned_retention',
  },
);

export const DomainOrder = model<IDomainOrder>('DomainOrder', DomainOrderSchema);

/**
 * Drop a leftover hard-delete TTL that briefly existed during development.
 * Mongoose never removes indexes that leave the schema, so without this the
 * old `ttl_abandoned_pending_payment` index would keep hard-deleting unpaid
 * checkouts after 3h and wipe the 30-day audit trail. Safe / idempotent.
 */
export const dropStaleAbandonedHardDeleteIndex = async (): Promise<void> => {
  const STALE_NAME = 'ttl_abandoned_pending_payment';
  try {
    const indexes = await DomainOrder.collection.indexes();
    const exists = indexes.some((idx) => idx.name === STALE_NAME);
    if (!exists) return;
    await DomainOrder.collection.dropIndex(STALE_NAME);
    console.log(`[DomainOrder] Dropped stale index "${STALE_NAME}".`);
  } catch (err) {
    // IndexAlreadyExists / NamespaceNotFound / race — never block startup.
    console.error('[DomainOrder] Could not drop stale TTL index (non-critical):', (err as Error).message);
  }
};
