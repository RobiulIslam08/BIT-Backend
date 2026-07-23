// ============================================
// BIT SOFTWARE — Domain Renewal Interface
// ============================================
// Audit trail for every renewal attempt (manual checkout or auto-renew).

import { Types } from 'mongoose';
import { TSupportedCurrency } from '../DomainOrder/domainOrder.interface';

export type TRenewalType = 'manual' | 'auto';
export type TRenewalPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type TRenewalStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface IDomainRenewal {
  domainId: Types.ObjectId;
  userId: Types.ObjectId;
  domainName: string;
  tld: string;

  type: TRenewalType;
  years: number;

  // pricing snapshot
  amountUSD: number;
  displayCurrency: TSupportedCurrency;
  displayAmount: number;
  exchangeRateUsed: number;

  managedByNamecheap: boolean;

  paymentMethod?: 'paypal' | 'wallet';
  paymentStatus: TRenewalPaymentStatus;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  paypalRefundId?: string;

  // Wallet payment (when paymentMethod === 'wallet')
  walletTransactionId?: Types.ObjectId;
  walletPromoUsed?: number;
  walletAccountUsed?: number;

  status: TRenewalStatus;
  providerOrderId?: string;
  previousExpiresAt?: Date;
  newExpiresAt?: Date;
  failureReason?: string;
  requiresManualRegistrarAction?: boolean; // legacy domains at other registrars

  createdAt?: Date;
  updatedAt?: Date;
}
