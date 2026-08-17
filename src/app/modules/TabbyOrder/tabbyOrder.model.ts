// ============================================
// BIT SOFTWARE — Tabby Business Order Model
// ============================================

import { Schema, model } from 'mongoose';
import { ITabbyOrder } from './tabbyOrder.interface';

const TabbyOrderSchema = new Schema<ITabbyOrder>(
  {
    orderId: { type: String, unique: true, sparse: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    legalCompanyName: { type: String, required: true, trim: true, maxlength: 200 },
    tradeName: { type: String, trim: true, maxlength: 200 },
    crNumber: { type: String, required: true, trim: true, maxlength: 20 },
    crIssueDate: { type: String, trim: true, maxlength: 30 },
    crExpiryDate: { type: String, trim: true, maxlength: 30 },
    vatRegistered: { type: Boolean, default: false },
    vatNumber: { type: String, trim: true, maxlength: 20 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    nationalAddressCode: { type: String, required: true, trim: true, maxlength: 20 },
    businessActivity: { type: String, trim: true, maxlength: 200, default: 'General business' },

    ownerName: { type: String, required: true, trim: true, maxlength: 200 },
    ownerRole: {
      type: String,
      enum: ['owner', 'authorized_signatory'],
      required: true,
      default: 'owner',
    },
    ownerNationalId: { type: String, required: true, trim: true, maxlength: 20 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    whatsapp: { type: String, trim: true, maxlength: 30 },

    website: { type: String, trim: true, maxlength: 500 },
    storeLocation: { type: String, trim: true, maxlength: 500 },
    integrationType: {
      type: String,
      enum: ['online', 'in_store', 'both'],
      required: true,
      default: 'online',
    },
    iban: { type: String, required: true, trim: true, uppercase: true, maxlength: 34 },
    bankName: { type: String, trim: true, maxlength: 120, default: 'As per IBAN letter' },

    amountSAR: { type: Number, required: true, min: 0 },
    amountUSD: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: ['paypal', 'wallet'], required: true },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    termsAccepted: { type: Boolean, required: true },

    paypalOrderId: { type: String, unique: true, sparse: true, trim: true },
    paypalCaptureId: { type: String, unique: true, sparse: true, trim: true },
    paypalTransactionId: { type: String, unique: true, sparse: true, trim: true },
    paypalRefundId: { type: String, trim: true },
    payerName: { type: String, trim: true, maxlength: 200 },
    payerEmail: { type: String, trim: true, maxlength: 254 },

    walletTransactionId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction' },
    walletPromoUsed: { type: Number, min: 0 },
    walletAccountUsed: { type: Number, min: 0 },

    orderStatus: {
      type: String,
      enum: ['pending_review', 'in_progress', 'completed', 'cancelled'],
      default: 'pending_review',
    },
    refundStatus: {
      type: String,
      enum: ['none', 'requested', 'processed', 'rejected'],
      default: 'none',
    },
    refundReason: { type: String, trim: true, maxlength: 1000 },
    refundRequestedAt: { type: Date },
    refundRejectedReason: { type: String, trim: true, maxlength: 1000 },
    refundedAt: { type: Date },
    promisedBy: { type: Date },

    adminNotes: { type: String, trim: true, maxlength: 2000 },
    tabbyMerchantId: { type: String, trim: true, maxlength: 80 },
    customerVisibleNotes: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

TabbyOrderSchema.index({ createdAt: -1 });
TabbyOrderSchema.index({ paymentStatus: 1, orderStatus: 1 });
TabbyOrderSchema.index({ refundStatus: 1 });
TabbyOrderSchema.index({ email: 1 });
TabbyOrderSchema.index({ crNumber: 1 });

export const TabbyOrder = model<ITabbyOrder>('TabbyOrder', TabbyOrderSchema);
