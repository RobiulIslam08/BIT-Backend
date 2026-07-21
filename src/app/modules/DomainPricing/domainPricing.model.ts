// ============================================
// BIT SOFTWARE — Domain Pricing Model
// ============================================

import { Schema, model } from 'mongoose';
import { IDomainPricing } from './domainPricing.interface';

const DomainPricingSchema = new Schema<IDomainPricing>(
  {
    tld: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 63,
      // Store without leading dot: "com", "co.uk"
      set: (v: string) => String(v || '').replace(/^\./, '').toLowerCase().trim(),
    },
    registerPriceUSD: { type: Number, required: true, min: 0, max: 100000 },
    renewPriceUSD: { type: Number, required: true, min: 0, max: 100000 },
    transferPriceUSD: { type: Number, required: true, min: 0, max: 100000 },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true, maxlength: 500 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

DomainPricingSchema.index({ isActive: 1, tld: 1 });

export const DomainPricing = model<IDomainPricing>('DomainPricing', DomainPricingSchema);
