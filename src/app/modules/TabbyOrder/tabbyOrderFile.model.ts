// ============================================
// BIT SOFTWARE — Tabby Order File (one doc per upload)
// ============================================
// Stored as base64 in MongoDB (Vercel filesystem is read-only).
// Separate collection so 5 PDFs never hit the 16 MB order document limit.

import { Schema, model } from 'mongoose';
import { ITabbyOrderFile } from './tabbyOrder.interface';

const TabbyOrderFileSchema = new Schema<ITabbyOrderFile>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'TabbyOrder', required: true, index: true },
    key: {
      type: String,
      enum: ['crCopy', 'nationalAddressPdf', 'vatCertificate', 'ibanCertificate', 'ownerIdCopy'],
      required: true,
    },
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true, trim: true, maxlength: 80 },
    size: { type: Number, required: true, min: 1 },
    data: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

TabbyOrderFileSchema.index({ orderId: 1, key: 1 }, { unique: true });

export const TabbyOrderFile = model<ITabbyOrderFile>('TabbyOrderFile', TabbyOrderFileSchema);
