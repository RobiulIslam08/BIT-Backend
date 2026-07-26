// ============================================
// BIT SOFTWARE — Cart Checkout Interfaces
// ============================================

import { Types } from 'mongoose';

export type TSupportedCurrency = 'SAR' | 'USD' | 'EUR' | 'CAD' | 'BDT' | 'PKR' | 'INR';
export type TCartPaymentStatus = 'pending' | 'paid' | 'failed' | 'partially_refunded' | 'refunded';
export type TCartCheckoutStatus =
  | 'pending_payment'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type TCartItemType = 'domain' | 'hosting';

export interface ICartDomainItemInput {
  type: 'domain';
  domainName: string;
}

export interface ICartHostingItemInput {
  type: 'hosting';
  planSlug: string;
  billingCycle: 'monthly' | 'yearly';
  websiteLabel?: string;
  attachedDomain?: string;
}

export type TCartItemInput = ICartDomainItemInput | ICartHostingItemInput;

export interface ICartLineResult {
  type: TCartItemType;
  label: string;
  sellPriceUSD: number;
  status: 'active' | 'failed' | 'pending';
  orderId?: string;
  dbOrderId?: string;
  failureReason?: string;
  refundedUSD?: number;
}

export interface ICartCheckout {
  cartCheckoutId: string;
  userId: Types.ObjectId;

  sellPriceUSD: number;
  displayCurrency: TSupportedCurrency;
  displayAmount: number;
  exchangeRateUsed: number;

  paymentMethod: 'paypal' | 'wallet';
  paymentStatus: TCartPaymentStatus;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  paypalTransactionId?: string;
  paypalRefundId?: string;

  walletTransactionId?: Types.ObjectId;
  walletPromoUsed?: number;
  walletAccountUsed?: number;

  status: TCartCheckoutStatus;
  failureReason?: string;
  abandonedAt?: Date;

  customerName: string;
  customerEmail: string;
  customerPhone?: string;

  domainOrderIds: Types.ObjectId[];
  hostingOrderIds: Types.ObjectId[];
  lineResults?: ICartLineResult[];

  createdAt?: Date;
  updatedAt?: Date;
}
