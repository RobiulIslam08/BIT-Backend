// ============================================
// BIT SOFTWARE — Business Email Asset Interface
// ============================================
// WHITE-LABEL: customer only sees purchased/assigned plan + webmail access.
// Internal provider details stay in admin-only fields.

import { Types } from 'mongoose';
import { TDomainOwnership } from '../EmailOrder/emailOrder.interface';

export type TEmailSource = 'purchase' | 'admin_assigned';
export type TEmailBillingCycle = 'monthly' | 'yearly';
export type TEmailStatus = 'active' | 'pending' | 'expired' | 'suspended' | 'cancelled';
export type TEmailProvisioningStatus = 'pending_setup' | 'ready';

export interface IEmail {
  userId: Types.ObjectId;

  planSlug: string;
  planName: string;
  billingCycle: TEmailBillingCycle;
  features: string[];

  // Intake snapshot
  businessName?: string;
  country?: string;
  teamSize?: string;
  domainName?: string;
  domainOwnership?: TDomainOwnership;
  adminFirstName?: string;
  adminLastName?: string;
  desiredEmailLocalPart?: string;
  recoveryEmail?: string;
  businessAddress?: string;
  customerPhone?: string;

  source: TEmailSource;
  status: TEmailStatus;
  provisioningStatus: TEmailProvisioningStatus;

  startsAt?: Date;
  expiresAt?: Date;

  amountUSD?: number;
  renewPriceUSD?: number;

  emailOrderId?: Types.ObjectId;
  emailPlanId?: Types.ObjectId;
  assignedBy?: Types.ObjectId;
  notes?: string;

  internalProvider?: string;
  internalAccountNote?: string;

  // Webmail credentials (password encrypted at rest)
  primaryEmail?: string | null;
  webmailUrl?: string | null;
  webmailUsername?: string | null;
  webmailPassword?: string | null;

  createdAt?: Date;
  updatedAt?: Date;
}
