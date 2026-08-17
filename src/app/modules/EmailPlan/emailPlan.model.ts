// ============================================
// BIT SOFTWARE — Business Email Plan Model
// ============================================

import { Schema, model } from 'mongoose';
import { IEmailPlan } from './emailPlan.interface';

const EmailPlanSchema = new Schema<IEmailPlan>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    monthlyPriceUSD: { type: Number, required: true, min: 0, max: 100000 },
    yearlyPriceUSD: { type: Number, required: true, min: 0, max: 100000 },
    features: { type: [String], default: [] },
    popular: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    notes: { type: String, trim: true, maxlength: 500 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

EmailPlanSchema.index({ isActive: 1, sortOrder: 1 });

export const EmailPlan = model<IEmailPlan>('EmailPlan', EmailPlanSchema);
