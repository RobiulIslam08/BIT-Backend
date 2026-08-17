// ============================================
// BIT SOFTWARE — Visitor Activity Interfaces
// ============================================

import { Types } from 'mongoose';

export type TActivityStatus = 'active' | 'left';

export interface IActivityPage {
  path: string;
  title?: string;
  enteredAt: Date;
  leftAt?: Date;
  durationMs?: number;
}

export interface IActivitySession {
  sessionId: string;
  visitorId: string;
  userId?: Types.ObjectId;
  name?: string;
  email?: string;
  userCode?: string;
  role?: string;
  pages: IActivityPage[];
  entryPage?: string;
  exitPage?: string | null;
  currentPage?: string;
  startedAt: Date;
  lastSeenAt: Date;
  endedAt?: Date | null;
  status: TActivityStatus;
  userAgent?: string;
  language?: string;
  ip?: string;
  referrer?: string;
  source?: string;
  utmMedium?: string;
  utmCampaign?: string;
  device?: string;
  browser?: string;
  intent?: string;
  isReturning?: boolean;
  whatsappClicks?: number;
  events?: { type: string; at: Date; path?: string }[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IActivityIngestContext {
  userId?: string;
  role?: string;
  ip?: string;
  userAgent?: string;
}
