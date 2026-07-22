// ============================================
// BIT SOFTWARE — Hosting Asset Interface
// ============================================
// Canonical record of hosting OWNED by a user:
//   - source = 'purchase'       → bought through our website
//   - source = 'admin_assigned' → legacy / existing client added by admin
//
// WHITE-LABEL: customer only sees their purchased/assigned plan.
// Internal provider details stay in admin-only fields (notes, internal*).

import { Types } from 'mongoose';

export type THostingSource = 'purchase' | 'admin_assigned';
export type THostingPlanType = 'shared' | 'vps';
export type THostingBillingCycle = 'monthly' | 'yearly';
export type THostingStatus = 'active' | 'pending' | 'expired' | 'suspended' | 'cancelled';

export interface IHostingProjectFile {
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  uploadedBy?: Types.ObjectId;
}

export interface IHosting {
  userId: Types.ObjectId;

  // ─── Customer-facing plan identity ───
  planSlug: string;
  planName: string;
  planType: THostingPlanType;
  billingCycle: THostingBillingCycle;
  features: string[];
  websiteLabel?: string; // e.g. domain or project name shown to customer

  // ─── Provenance ───
  source: THostingSource;
  status: THostingStatus;

  // ─── Lifecycle ───
  startsAt?: Date;
  expiresAt?: Date;

  // ─── Pricing snapshot (what customer paid / renews) ───
  amountUSD?: number;
  renewPriceUSD?: number;

  // ─── Project ZIP (customer download) ───
  projectFile?: IHostingProjectFile | null;

  // ─── Linkage / audit ───
  hostingOrderId?: Types.ObjectId;
  hostingPlanId?: Types.ObjectId;
  assignedBy?: Types.ObjectId;
  notes?: string; // admin-only, never sent to customer responses

  // ─── Internal ops (admin-only, never exposed to customer) ───
  internalProvider?: string;
  internalServerNote?: string;

  createdAt?: Date;
  updatedAt?: Date;
}
