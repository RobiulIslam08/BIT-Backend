// ============================================
// BIT SOFTWARE — Digital Service Asset Model
// ============================================

import { Schema, model } from 'mongoose';
import { IDigitalService } from './digitalService.interface';
import { DIGITAL_PACKAGE_TYPES, DIGITAL_SERVICE_KEYS } from './digitalService.catalog';

const DigitalServiceSchema = new Schema<IDigitalService>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    serviceKey: {
      type: String,
      enum: DIGITAL_SERVICE_KEYS,
      required: true,
      index: true,
    },
    serviceName: { type: String, required: true, trim: true, maxlength: 120 },
    packageType: {
      type: String,
      enum: DIGITAL_PACKAGE_TYPES,
      required: true,
      index: true,
    },
    packageLabel: { type: String, required: true, trim: true, maxlength: 80 },

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

    amountSAR: { type: Number, min: 0 },
    amountUSD: { type: Number, min: 0 },

    orderId: { type: Schema.Types.ObjectId, ref: 'DigitalServiceOrder' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    portalUrl: { type: String, trim: true, maxlength: 500 },
    accessNotes: { type: String, trim: true, maxlength: 2000 },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

DigitalServiceSchema.index({ userId: 1, serviceKey: 1, createdAt: -1 });
DigitalServiceSchema.index({ status: 1, expiresAt: 1 });

export const DigitalService = model<IDigitalService>('DigitalService', DigitalServiceSchema);
