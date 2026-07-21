// ============================================
// BIT SOFTWARE — Domain Order Interface
// ============================================

import { Types } from 'mongoose';

export type TDomainPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type TDomainOrderStatus =
  | 'pending_payment'
  | 'processing'
  | 'active'
  | 'failed'
  | 'cancelled';

export type TSupportedCurrency = 'SAR' | 'USD' | 'EUR' | 'CAD' | 'BDT' | 'PKR' | 'INR';

export interface IDomainOrder {
  // ─── Order Identity ───
  orderId: string;           // human-readable e.g. DOM-123456
  userId: Types.ObjectId;    // ref to User
  
  // ─── Domain Info ───
  domainName: string;        // full: e.g. "example.com"
  sld: string;               // second-level: "example"
  tld: string;               // top-level: "com"
  registrationYears: number; // 1 (expandable later)
  whoisPrivacy: boolean;     // default true, free

  // ─── Pricing ───
  sellPriceUSD: number;      // our fixed sell price in USD
  displayCurrency: TSupportedCurrency; // what customer chose to see
  displayAmount: number;     // converted price shown at checkout
  exchangeRateUsed: number;  // rate at time of purchase (audit trail)

  // ─── Payment ───
  paymentMethod: 'paypal';   // bKash added later
  paymentStatus: TDomainPaymentStatus;
  paypalOrderId?: string;    // PayPal order ID (unique)
  paypalCaptureId?: string;  // PayPal capture ID (for refund)
  paypalTransactionId?: string;
  paypalRefundId?: string;   // if refunded

  // ─── Order Status ───
  orderStatus: TDomainOrderStatus;
  failureReason?: string;    // if registration failed
  refundedAt?: Date;
  abandonedAt?: Date;        // set when an unpaid checkout is auto-cancelled; drives TTL cleanup

  // ─── Namecheap Registration ───
  namecheapOrderId?: string; // Namecheap's returned order ID
  registeredAt?: Date;
  expiresAt?: Date;          // registeredAt + registrationYears

  // ─── Customer Contact (stored for domain registration) ───
  customerName: string;
  customerEmail: string;
  customerPhone?: string;

  // ─── Timestamps ───
  createdAt?: Date;
  updatedAt?: Date;
}
