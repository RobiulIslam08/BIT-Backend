// ============================================
// BIT SOFTWARE — Visitor Activity Session Model
// ============================================

import { Schema, model } from 'mongoose';
import { IActivitySession } from './visitorActivity.interface';

const ActivityPageSchema = new Schema(
  {
    path: { type: String, required: true, trim: true, maxlength: 500 },
    title: { type: String, trim: true, maxlength: 300 },
    enteredAt: { type: Date, required: true },
    leftAt: { type: Date },
    durationMs: { type: Number, min: 0 },
  },
  { _id: false },
);

const ActivityEventSchema = new Schema(
  {
    type: { type: String, required: true, trim: true, maxlength: 40 },
    at: { type: Date, required: true },
    path: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const ActivitySessionSchema = new Schema<IActivitySession>(
  {
    sessionId: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    visitorId: { type: String, required: true, trim: true, maxlength: 80, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    name: { type: String, trim: true, maxlength: 100 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    userCode: { type: String, trim: true, maxlength: 20 },
    role: { type: String, trim: true, maxlength: 20 },
    pages: { type: [ActivityPageSchema], default: [] },
    entryPage: { type: String, trim: true, maxlength: 500 },
    exitPage: { type: String, trim: true, maxlength: 500 },
    currentPage: { type: String, trim: true, maxlength: 500 },
    startedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true, index: true },
    endedAt: { type: Date },
    status: {
      type: String,
      enum: ['active', 'left'],
      default: 'active',
      index: true,
    },
    userAgent: { type: String, trim: true, maxlength: 500 },
    language: { type: String, trim: true, maxlength: 32 },
    ip: { type: String, trim: true, maxlength: 64 },
    referrer: { type: String, trim: true, maxlength: 500 },
    source: { type: String, trim: true, maxlength: 80, index: true },
    utmMedium: { type: String, trim: true, maxlength: 80 },
    utmCampaign: { type: String, trim: true, maxlength: 120 },
    device: { type: String, trim: true, maxlength: 20, index: true },
    browser: { type: String, trim: true, maxlength: 40 },
    intent: { type: String, trim: true, maxlength: 40, index: true },
    isReturning: { type: Boolean, default: false },
    whatsappClicks: { type: Number, default: 0, min: 0 },
    events: { type: [ActivityEventSchema], default: [] },
  },
  { timestamps: true },
);

ActivitySessionSchema.index({ status: 1, lastSeenAt: -1 });
ActivitySessionSchema.index({ userId: 1, startedAt: -1 });
ActivitySessionSchema.index({ name: 1 });
ActivitySessionSchema.index({ email: 1 });
ActivitySessionSchema.index({ userCode: 1 });

export const ActivitySession = model<IActivitySession>(
  'ActivitySession',
  ActivitySessionSchema,
);
