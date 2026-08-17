// ============================================
// BIT SOFTWARE — Business Email Asset Model
// ============================================

import { Schema, model } from 'mongoose';
import { IEmail } from './email.interface';

const EmailSchema = new Schema<IEmail>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    planSlug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    planName: { type: String, required: true, trim: true, maxlength: 100 },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly'],
      required: true,
      default: 'yearly',
    },
    features: { type: [String], default: [] },

    businessName: { type: String, trim: true, maxlength: 200 },
    country: { type: String, trim: true, maxlength: 100 },
    teamSize: { type: String, trim: true, maxlength: 50 },
    domainName: { type: String, trim: true, lowercase: true, maxlength: 253 },
    domainOwnership: {
      type: String,
      enum: ['i_have_domain', 'need_domain_help'],
    },
    adminFirstName: { type: String, trim: true, maxlength: 100 },
    adminLastName: { type: String, trim: true, maxlength: 100 },
    desiredEmailLocalPart: { type: String, trim: true, lowercase: true, maxlength: 64 },
    recoveryEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    businessAddress: { type: String, trim: true, maxlength: 500 },
    customerPhone: { type: String, trim: true, maxlength: 30 },

    source: {
      type: String,
      enum: ['purchase', 'admin_assigned'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'pending', 'expired', 'suspended', 'cancelled'],
      default: 'active',
      index: true,
    },
    provisioningStatus: {
      type: String,
      enum: ['pending_setup', 'ready'],
      default: 'pending_setup',
      index: true,
    },

    startsAt: { type: Date },
    expiresAt: { type: Date, index: true },

    amountUSD: { type: Number, min: 0 },
    renewPriceUSD: { type: Number, min: 0 },

    emailOrderId: { type: Schema.Types.ObjectId, ref: 'EmailOrder', unique: true, sparse: true },
    emailPlanId: { type: Schema.Types.ObjectId, ref: 'EmailPlan' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true, maxlength: 2000 },

    internalProvider: { type: String, trim: true, maxlength: 100 },
    internalAccountNote: { type: String, trim: true, maxlength: 2000 },

    primaryEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    webmailUrl: { type: String, trim: true, maxlength: 500 },
    webmailUsername: { type: String, trim: true, maxlength: 128 },
    webmailPassword: { type: String, maxlength: 1000 },
  },
  { timestamps: true },
);

EmailSchema.index({ userId: 1, status: 1, createdAt: -1 });
EmailSchema.index({ planSlug: 1, status: 1 });
EmailSchema.index({ domainName: 1 });

export const Email = model<IEmail>('Email', EmailSchema);
