// ============================================
// BIT SOFTWARE — GMB Order Interface
// ============================================

import { Types } from 'mongoose';

export type TServiceType = 'new' | 'recovery' | 'regular';
export type TPaymentMethod = 'paypal' | 'manual' | 'wallet';
export type TPaymentStatus = 'pending_verification' | 'paid' | 'failed' | 'due';
export type TOrderStatus = 'pending_review' | 'in_progress' | 'completed' | 'cancelled';

export interface ITransactionDetails {
  transactionId?: string;
  paymentMethodDetail?: string;
  senderName?: string;
  paymentDate?: string;
}

export interface IBusinessDayHours {
  active: boolean;
  open: string;
  close: string;
}

export type TBusinessHours = Record<string, IBusinessDayHours>;

export interface IGmbOrder {
  orderId?: string;
  // Optional owning user (set when logged-in customer places order)
  userId?: Types.ObjectId;
  // Linked owned profile asset (set when profile is provisioned)
  gmbProfileId?: Types.ObjectId;
  // Business info
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

  // Contact info
  phone: string;
  whatsapp?: string;
  email: string;
  website?: string;

  // Business details
  description?: string;
  servicesList?: string;
  businessHours?: TBusinessHours;

  // Service & pricing
  serviceType: TServiceType;
  hasExistingProfile: boolean;
  profileHasIssues?: boolean;
  recoveryEmail?: string;
  recoveryPhone?: string;
  originalPrice: number;
  couponCode?: string;
  discountAmount: number;
  finalAmount: number;

  // Payment
  paymentMethod: TPaymentMethod;
  paymentStatus: TPaymentStatus;
  termsAccepted: boolean;

  // PayPal
  paypalOrderId?: string;
  paypalTransactionId?: string;
  payerName?: string;
  payerEmail?: string;

  // Wallet payment (when paymentMethod === 'wallet')
  walletTransactionId?: Types.ObjectId;
  walletPromoUsed?: number;
  walletAccountUsed?: number;

  // Manual payment
  transactionDetails?: ITransactionDetails;
  paymentScreenshot?: string; // stored file path after upload

  // Order status
  orderStatus: TOrderStatus;
  createdAt?: Date;
}
