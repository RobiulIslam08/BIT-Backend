// ============================================
// BIT SOFTWARE — Domain Asset Mongoose Model
// ============================================

import { Schema, model } from 'mongoose';
import { IDomain } from './domainAsset.interface';

const DomainSchema = new Schema<IDomain>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ─── Domain identity ───
    domainName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 253,
      unique: true,
    },
    sld: { type: String, required: true, trim: true, lowercase: true, maxlength: 63 },
    tld: { type: String, required: true, trim: true, lowercase: true, maxlength: 63 },

    // ─── Provenance ───
    source: {
      type: String,
      enum: ['purchase', 'admin_assigned'],
      required: true,
      index: true,
    },
    registrar: { type: String, trim: true, maxlength: 100, default: 'BIT' },
    managedByNamecheap: { type: Boolean, default: false },

    // ─── Lifecycle ───
    status: {
      type: String,
      enum: ['active', 'expired', 'pending', 'cancelled', 'transferred_out'],
      default: 'active',
      index: true,
    },
    registeredAt: { type: Date },
    expiresAt: { type: Date, index: true },
    registrationYears: { type: Number, default: 1, min: 1, max: 10 },

    // ─── Renewal / pricing ───
    renewPriceUSD: { type: Number, min: 0 },
    renewPriceSource: {
      type: String,
      enum: ['provider', 'manual'],
      default: 'manual',
    },
    autoRenew: { type: Boolean, default: false },
    autoRenewStatus: {
      type: String,
      enum: ['inactive', 'ready', 'failed'],
      default: 'inactive',
    },
    lastRenewedAt: { type: Date },
    lastAutoRenewError: { type: String, trim: true, maxlength: 1000 },
    expiryReminderSentAt: { type: Date },

    // ─── DNS / privacy ───
    whoisPrivacy: { type: Boolean, default: true },
    nameservers: { type: [String], default: [] },

    // ─── Linkage / audit ───
    domainOrderId: { type: Schema.Types.ObjectId, ref: 'DomainOrder' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  {
    timestamps: true,
  },
);

// ─── Indexes ───
DomainSchema.index({ userId: 1, status: 1, createdAt: -1 }); // user's domain list
DomainSchema.index({ expiresAt: 1, autoRenew: 1, status: 1 }); // renewal engine scans
DomainSchema.index({ registrar: 1 });

export const Domain = model<IDomain>('Domain', DomainSchema);
