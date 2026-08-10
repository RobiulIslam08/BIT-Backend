// ============================================
// BIT SOFTWARE — GMB Profile Asset Model
// ============================================

import { Schema, model } from 'mongoose';
import { IGmbProfile } from './gmbProfile.interface';

const DayHoursSchema = new Schema(
  {
    active: { type: Boolean, default: false },
    open: { type: String, trim: true, maxlength: 10, default: '09:00' },
    close: { type: String, trim: true, maxlength: 10, default: '18:00' },
  },
  { _id: false },
);

const GmbProfileSchema = new Schema<IGmbProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

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

    phone: { type: String, required: true, trim: true, maxlength: 30 },
    whatsapp: { type: String, trim: true, maxlength: 30 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    website: { type: String, trim: true, maxlength: 500 },

    description: { type: String, trim: true, maxlength: 5000 },
    servicesList: { type: String, trim: true, maxlength: 5000 },
    businessHours: { type: Map, of: DayHoursSchema },

    serviceType: {
      type: String,
      enum: ['new', 'recovery', 'regular'],
      required: true,
    },

    source: {
      type: String,
      enum: ['purchase', 'admin_assigned'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'active', 'suspended', 'cancelled'],
      default: 'pending',
      index: true,
    },

    startsAt: { type: Date },
    googleProfileUrl: { type: String, trim: true, maxlength: 1000 },
    placeId: { type: String, trim: true, maxlength: 200 },

    amountSAR: { type: Number, min: 0 },

    gmbOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'GmbOrder',
      index: true,
      sparse: true,
    },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

GmbProfileSchema.index({ createdAt: -1 });
GmbProfileSchema.index({ userId: 1, status: 1 });

export const GmbProfile = model<IGmbProfile>('GmbProfile', GmbProfileSchema);
