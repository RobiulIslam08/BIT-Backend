// ============================================
// BIT SOFTWARE — GMB Profile Asset Interface
// ============================================
// Canonical record of a Google Business Profile OWNED by a user:
//   - source = 'purchase'       → created from a GMB order
//   - source = 'admin_assigned' → added/assigned by admin
//
// Customers see their profiles in My Account (including pending).

import { Types } from 'mongoose';

export type TGmbProfileSource = 'purchase' | 'admin_assigned';
export type TGmbProfileStatus = 'pending' | 'in_progress' | 'active' | 'suspended' | 'cancelled';
export type TGmbServiceType = 'new' | 'recovery' | 'regular';

export interface IBusinessDayHours {
  active: boolean;
  open: string;
  close: string;
}

/** Keys match the GMB wizard (Mon…Sun). */
export type TBusinessHours = Record<string, IBusinessDayHours>;

export interface IGmbProfile {
  userId: Types.ObjectId;

  // ─── Business snapshot ───
  businessName: string;
  category: string;
  hasPhysicalLocation: 'yes' | 'no';
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  serviceAreas?: string;

  phone: string;
  whatsapp?: string;
  email: string;
  website?: string;

  description?: string;
  servicesList?: string;
  businessHours?: TBusinessHours;

  serviceType: TGmbServiceType;

  // ─── Provenance ───
  source: TGmbProfileSource;
  status: TGmbProfileStatus;

  // ─── Lifecycle ───
  startsAt?: Date;
  googleProfileUrl?: string;
  placeId?: string;

  // ─── Pricing snapshot (SAR) ───
  amountSAR?: number;

  // ─── Linkage / audit ───
  gmbOrderId?: Types.ObjectId;
  assignedBy?: Types.ObjectId;
  notes?: string; // admin-only

  createdAt?: Date;
  updatedAt?: Date;
}
