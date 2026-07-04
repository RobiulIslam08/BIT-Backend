// ============================================
// BIT SOFTWARE — GMB Order Mongoose Model (Production)
// ============================================

import { Schema, model } from 'mongoose';
import { IGmbOrder } from './gmbOrder.interface';

const GmbOrderSchema = new Schema<IGmbOrder>(
  {
    orderId: { type: String, unique: true, sparse: true, trim: true },
    // ─── Business Info ───
    businessName: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, required: true, trim: true, maxlength: 200 },
    hasPhysicalLocation: { type: String, enum: ['yes', 'no'], required: true },
    streetAddress: { type: String, trim: true, maxlength: 500 },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    country: { type: String, trim: true, maxlength: 100 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    serviceAreas: { type: String, trim: true, maxlength: 1000 },

    // ─── Contact Info ───
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    whatsapp: { type: String, trim: true, maxlength: 30 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    website: { type: String, trim: true, maxlength: 500 },

    // ─── Business Details ───
    description: { type: String, trim: true, maxlength: 5000 },
    servicesList: { type: String, trim: true, maxlength: 5000 },

    // ─── Service & Pricing ───
    serviceType: {
      type: String,
      enum: ['new', 'recovery', 'regular'],
      required: true,
    },
    hasExistingProfile: { type: Boolean, default: false },
    profileHasIssues: { type: Boolean, default: false },
    recoveryEmail: { type: String, trim: true, maxlength: 254 },
    recoveryPhone: { type: String, trim: true, maxlength: 30 },
    originalPrice: { type: Number, required: true, min: 0 },
    couponCode: { type: String, trim: true, uppercase: true, maxlength: 30 },
    discountAmount: { type: Number, default: 0, min: 0 },
    finalAmount: { type: Number, required: true, min: 0 },

    // ─── Payment ───
    paymentMethod: {
      type: String,
      enum: ['paypal', 'manual'],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending_verification', 'paid', 'failed'],
      default: 'pending_verification',
    },
    termsAccepted: { type: Boolean, required: true },

    // ─── PayPal Details ───
    // sparse: true → allows multiple null values (for manual orders)
    paypalOrderId: { type: String, unique: true, sparse: true, trim: true },
    paypalTransactionId: { type: String, unique: true, sparse: true, trim: true },
    payerName: { type: String, trim: true, maxlength: 200 },
    payerEmail: { type: String, trim: true, maxlength: 254 },

    // ─── Manual Payment ───
    transactionDetails: {
      transactionId: { type: String, trim: true, maxlength: 100 },
      paymentMethodDetail: { type: String, trim: true, maxlength: 50 },
      senderName: { type: String, trim: true, maxlength: 200 },
      paymentDate: { type: String, trim: true, maxlength: 30 },
    },
    paymentScreenshot: { type: String }, // base64 data URI (stored in MongoDB, no filesystem)

    // ─── Order Status ───
    orderStatus: {
      type: String,
      enum: ['pending_review', 'in_progress', 'completed', 'cancelled'],
      default: 'pending_review',
    },
  },
  {
    timestamps: true,
    // strict: true (default) — do NOT allow extra fields to be saved to DB
  },
);

// ─── Indexes for performance & query optimization ───
GmbOrderSchema.index({ createdAt: -1 }); // latest orders first
GmbOrderSchema.index({ paymentStatus: 1, orderStatus: 1 }); // admin filters
GmbOrderSchema.index({ email: 1 }); // customer lookup

export const GmbOrder = model<IGmbOrder>('GmbOrder', GmbOrderSchema);
