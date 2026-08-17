// ============================================
// BIT SOFTWARE — Business Email Order Interface
// ============================================

import { Types } from 'mongoose';

export type TEmailPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type TEmailOrderStatus =
  | 'pending_payment'
  | 'processing'
  | 'active'
  | 'failed'
  | 'cancelled';

export type TSupportedCurrency = 'SAR' | 'USD' | 'EUR' | 'CAD' | 'BDT' | 'PKR' | 'INR';
export type TEmailBillingCycle = 'monthly' | 'yearly';
export type TDomainOwnership = 'i_have_domain' | 'need_domain_help';

/** Workspace-style intake collected at checkout (white-label). */
export interface IEmailIntake {
  businessName: string;
  country: string;
  teamSize?: string;
  domainName: string;
  domainOwnership?: TDomainOwnership;
  adminFirstName: string;
  adminLastName: string;
  desiredEmailLocalPart: string;
  recoveryEmail: string;
  businessAddress?: string;
}

export interface IEmailOrder extends IEmailIntake {
  orderId: string;
  userId: Types.ObjectId;

  planSlug: string;
  planName: string;
  billingCycle: TEmailBillingCycle;
  features: string[];

  sellPriceUSD: number;
  displayCurrency: TSupportedCurrency;
  displayAmount: number;
  exchangeRateUsed: number;

  paymentMethod: 'paypal' | 'wallet';
  paymentStatus: TEmailPaymentStatus;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  paypalTransactionId?: string;
  paypalRefundId?: string;

  walletTransactionId?: Types.ObjectId;
  walletPromoUsed?: number;
  walletAccountUsed?: number;

  orderStatus: TEmailOrderStatus;
  failureReason?: string;
  refundedAt?: Date;
  abandonedAt?: Date;

  startsAt?: Date;
  expiresAt?: Date;
  emailAssetId?: Types.ObjectId;
  emailPlanId?: Types.ObjectId;

  customerName: string;
  customerEmail: string;
  customerPhone: string;

  cartCheckoutId?: string;
  /** Client-generated key so retries / double-clicks never charge twice. */
  idempotencyKey?: string;

  createdAt?: Date;
  updatedAt?: Date;
}
