// ============================================
// BIT SOFTWARE — Domain Asset Interface
// ============================================
// A "Domain Asset" is the canonical record of a domain OWNED by a user,
// regardless of how it was acquired:
//   - source = 'purchase'        → bought through our website (linked to a DomainOrder)
//   - source = 'admin_assigned'  → legacy domain added manually by an admin
//
// This is the single source of truth for the customer's "My Domains" view.
// ============================================

import { Types } from 'mongoose';

export type TDomainSource = 'purchase' | 'admin_assigned';

export type TDomainStatus =
  | 'active'
  | 'expired'
  | 'pending'
  | 'cancelled'
  | 'transferred_out';

export type TRenewPriceSource = 'provider' | 'manual';

export type TAutoRenewStatus = 'inactive' | 'ready' | 'failed';

export interface IDomain {
  userId: Types.ObjectId; // owner (ref User)

  // ─── Domain identity ───
  domainName: string; // full: "example.com"
  sld: string; // "example"
  tld: string; // "com"

  // ─── Provenance ───
  source: TDomainSource;
  registrar: string; // display registrar e.g. "GoDaddy", "Namecheap", "BIT"
  managedByNamecheap: boolean; // true → we can auto price/renew via provider

  // ─── Lifecycle ───
  status: TDomainStatus;
  registeredAt?: Date;
  expiresAt?: Date;
  registrationYears: number;

  // ─── Renewal / pricing (USD is the base currency) ───
  renewPriceUSD?: number; // retail/renew fee shown to customer
  renewPriceSource: TRenewPriceSource;
  autoRenew: boolean;
  autoRenewStatus: TAutoRenewStatus;
  lastRenewedAt?: Date;
  lastAutoRenewError?: string;
  expiryReminderSentAt?: Date; // dedupe reminder emails

  // ─── DNS / privacy ───
  whoisPrivacy: boolean;
  nameservers: string[];

  // ─── Linkage / audit ───
  domainOrderId?: Types.ObjectId; // ref DomainOrder (if source === 'purchase')
  assignedBy?: Types.ObjectId; // ref User (admin who added it)
  notes?: string; // internal admin notes (never shown to customer)

  createdAt?: Date;
  updatedAt?: Date;
}
