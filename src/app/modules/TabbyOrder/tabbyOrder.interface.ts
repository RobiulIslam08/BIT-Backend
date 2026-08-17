// ============================================
// BIT SOFTWARE — Tabby Business Order Types
// ============================================

import { Types } from 'mongoose';

export type TTabbyPaymentMethod = 'paypal' | 'wallet';
export type TTabbyPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type TTabbyOrderStatus = 'pending_review' | 'in_progress' | 'completed' | 'cancelled';
export type TTabbyRefundStatus = 'none' | 'requested' | 'processed' | 'rejected';
export type TTabbyIntegrationType = 'online' | 'in_store' | 'both';
export type TTabbyOwnerRole = 'owner' | 'authorized_signatory';

export type TTabbyFileKey =
  | 'crCopy'
  | 'nationalAddressPdf'
  | 'vatCertificate'
  | 'ibanCertificate'
  | 'ownerIdCopy';

export interface ITabbyOrderFile {
  orderId: Types.ObjectId;
  key: TTabbyFileKey;
  originalName: string;
  mimeType: string;
  size: number;
  data: string; // base64 (no data URI prefix)
  createdAt?: Date;
}

export interface ITabbyOrderFileMeta {
  _id: Types.ObjectId | string;
  key: TTabbyFileKey;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface ITabbyOrder {
  orderId?: string;
  userId: Types.ObjectId;

  legalCompanyName: string;
  tradeName?: string;
  crNumber: string;
  crIssueDate?: string;
  crExpiryDate?: string;
  vatRegistered: boolean;
  vatNumber?: string;
  city: string;
  nationalAddressCode: string;
  businessActivity: string;

  ownerName: string;
  ownerRole: TTabbyOwnerRole;
  ownerNationalId: string;
  email: string;
  phone: string;
  whatsapp?: string;

  website?: string;
  storeLocation?: string;
  integrationType: TTabbyIntegrationType;
  iban: string;
  bankName: string;

  amountSAR: number;
  amountUSD: number;
  paymentMethod: TTabbyPaymentMethod;
  paymentStatus: TTabbyPaymentStatus;
  termsAccepted: boolean;

  paypalOrderId?: string;
  paypalCaptureId?: string;
  paypalTransactionId?: string;
  paypalRefundId?: string;
  payerName?: string;
  payerEmail?: string;

  walletTransactionId?: Types.ObjectId;
  walletPromoUsed?: number;
  walletAccountUsed?: number;

  orderStatus: TTabbyOrderStatus;
  refundStatus: TTabbyRefundStatus;
  refundReason?: string;
  refundRequestedAt?: Date;
  refundRejectedReason?: string;
  refundedAt?: Date;
  promisedBy?: Date;

  adminNotes?: string;
  tabbyMerchantId?: string;
  customerVisibleNotes?: string;

  createdAt?: Date;
  updatedAt?: Date;
}
