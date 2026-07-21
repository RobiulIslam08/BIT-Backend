// ============================================
// BIT SOFTWARE — Domain Renewal Mongoose Model
// ============================================

import { Schema, model } from 'mongoose';
import { IDomainRenewal } from './domainRenewal.interface';

const DomainRenewalSchema = new Schema<IDomainRenewal>(
  {
    domainId: { type: Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    domainName: { type: String, required: true, trim: true, lowercase: true },
    tld: { type: String, required: true, trim: true, lowercase: true },

    type: { type: String, enum: ['manual', 'auto'], required: true },
    years: { type: Number, default: 1, min: 1, max: 10 },

    amountUSD: { type: Number, required: true, min: 0 },
    displayCurrency: {
      type: String,
      enum: ['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'],
      default: 'USD',
    },
    displayAmount: { type: Number, required: true, min: 0 },
    exchangeRateUsed: { type: Number, required: true, min: 0 },

    managedByNamecheap: { type: Boolean, default: false },

    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
      index: true,
    },
    paypalOrderId: { type: String, unique: true, sparse: true, trim: true },
    paypalCaptureId: { type: String, trim: true },
    paypalRefundId: { type: String, trim: true },

    status: {
      type: String,
      // 'processing' = atomic claim lock so concurrent completeRenew calls
      // cannot overwrite a successful capture/fulfilment with a failed status.
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    providerOrderId: { type: String, trim: true },
    previousExpiresAt: { type: Date },
    newExpiresAt: { type: Date },
    failureReason: { type: String, trim: true, maxlength: 1000 },
    requiresManualRegistrarAction: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const DomainRenewal = model<IDomainRenewal>('DomainRenewal', DomainRenewalSchema);
