// ============================================
// BIT SOFTWARE — Digital Service Order Interface
// ============================================

import { Types } from 'mongoose';
import { TDigitalPackageType, TDigitalServiceKey } from '../DigitalService/digitalService.catalog';

export type TDigitalPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type TDigitalOrderStatus =
  | 'pending_payment'
  | 'processing'
  | 'active'
  | 'failed'
  | 'cancelled';

export interface IDigitalServiceOrder {
  orderId: string;
  userId: Types.ObjectId;

  serviceKey: TDigitalServiceKey;
  serviceName: string;
  packageType: TDigitalPackageType;
  packageLabel: string;
  durationDays: number;

  amountSAR: number;
  amountUSD: number;
  exchangeRateUsed: number;

  paymentMethod: 'paypal' | 'wallet';
  paymentStatus: TDigitalPaymentStatus;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  paypalTransactionId?: string;
  paypalRefundId?: string;

  walletTransactionId?: Types.ObjectId;
  walletPromoUsed?: number;
  walletAccountUsed?: number;

  orderStatus: TDigitalOrderStatus;
  failureReason?: string;
  refundedAt?: Date;
  abandonedAt?: Date;

  startsAt?: Date;
  expiresAt?: Date;
  digitalServiceId?: Types.ObjectId;

  customerName: string;
  customerEmail: string;
  customerPhone?: string;

  createdAt?: Date;
  updatedAt?: Date;
}
