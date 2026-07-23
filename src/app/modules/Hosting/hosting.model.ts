// ============================================
// BIT SOFTWARE — Hosting Asset Model
// ============================================

import { Schema, model } from 'mongoose';
import { IHosting } from './hosting.interface';

const ProjectFileSchema = new Schema(
  {
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    storedName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true, trim: true, maxlength: 120 },
    size: { type: Number, required: true, min: 0 },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const HostingSchema = new Schema<IHosting>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    planSlug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    planName: { type: String, required: true, trim: true, maxlength: 100 },
    planType: {
      type: String,
      enum: ['shared', 'vps'],
      required: true,
      index: true,
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly'],
      required: true,
      default: 'yearly',
    },
    features: { type: [String], default: [] },
    websiteLabel: { type: String, trim: true, maxlength: 253 },

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

    startsAt: { type: Date },
    expiresAt: { type: Date, index: true },

    amountUSD: { type: Number, min: 0 },
    renewPriceUSD: { type: Number, min: 0 },

    projectFile: { type: ProjectFileSchema, default: null },

    hostingOrderId: { type: Schema.Types.ObjectId, ref: 'HostingOrder' },
    hostingPlanId: { type: Schema.Types.ObjectId, ref: 'HostingPlan' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true, maxlength: 2000 },

    internalProvider: { type: String, trim: true, maxlength: 100 },
    internalServerNote: { type: String, trim: true, maxlength: 2000 },

    // cPanel credentials — password stored encrypted (AES-256-GCM)
    cpanelUrl: { type: String, trim: true, maxlength: 500 },
    cpanelUsername: { type: String, trim: true, maxlength: 128 },
    cpanelPassword: { type: String, maxlength: 1000 },
    cpanelDomain: { type: String, trim: true, maxlength: 253 },
  },
  { timestamps: true },
);

HostingSchema.index({ userId: 1, status: 1, createdAt: -1 });
HostingSchema.index({ planSlug: 1, status: 1 });

export const Hosting = model<IHosting>('Hosting', HostingSchema);
