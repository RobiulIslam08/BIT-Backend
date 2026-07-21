// ============================================
// BIT SOFTWARE — Payment Method Mongoose Model
// ============================================

import { Schema, model } from 'mongoose';
import { IPaymentMethod } from './paymentMethod.interface';

const PaymentMethodSchema = new Schema<IPaymentMethod>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['paypal'],
      required: true,
      default: 'paypal',
    },
    vaultId: { type: String, required: true, unique: true, trim: true },
    customerId: { type: String, trim: true },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    isDefault: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['active', 'removed'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true },
);

PaymentMethodSchema.index({ userId: 1, status: 1 });

export const PaymentMethod = model<IPaymentMethod>('PaymentMethod', PaymentMethodSchema);
