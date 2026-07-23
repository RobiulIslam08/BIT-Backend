// ============================================
// BIT SOFTWARE — Hosting Order Interface
// ============================================

import { Types } from 'mongoose';

export type THostingPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type THostingOrderStatus =
  | 'pending_payment'
  | 'processing'
  | 'active'
  | 'failed'
  | 'cancelled';

export type TSupportedCurrency = 'SAR' | 'USD' | 'EUR' | 'CAD' | 'BDT' | 'PKR' | 'INR';
export type THostingBillingCycle = 'monthly' | 'yearly';
export type THostingPlanType = 'shared' | 'vps';

export interface IHostingOrder {
  orderId: string;
  userId: Types.ObjectId;

  planSlug: string;
  planName: string;
  planType: THostingPlanType;
  billingCycle: THostingBillingCycle;
  features: string[];
  websiteLabel?: string;

  sellPriceUSD: number;
  displayCurrency: TSupportedCurrency;
  displayAmount: number;
  exchangeRateUsed: number;

  paymentMethod: 'paypal' | 'wallet';
  paymentStatus: THostingPaymentStatus;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  paypalTransactionId?: string;
  paypalRefundId?: string;

  // ─── Wallet payment (when paymentMethod === 'wallet') ───
  walletTransactionId?: Types.ObjectId;
  walletPromoUsed?: number;
  walletAccountUsed?: number;

  orderStatus: THostingOrderStatus;
  failureReason?: string;
  refundedAt?: Date;
  abandonedAt?: Date;

  startsAt?: Date;
  expiresAt?: Date;
  hostingAssetId?: Types.ObjectId;
  hostingPlanId?: Types.ObjectId;

  customerName: string;
  customerEmail: string;
  customerPhone?: string;

  createdAt?: Date;
  updatedAt?: Date;
}
