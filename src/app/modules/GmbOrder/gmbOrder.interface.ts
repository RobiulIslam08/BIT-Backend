// ============================================
// BIT SOFTWARE — GMB Order Interface
// ============================================

export type TServiceType = 'new' | 'recovery' | 'regular';
export type TPaymentMethod = 'paypal' | 'manual';
export type TPaymentStatus = 'pending_verification' | 'paid' | 'failed';
export type TOrderStatus = 'pending_review' | 'in_progress' | 'completed' | 'cancelled';

export interface ITransactionDetails {
  transactionId?: string;
  paymentMethodDetail?: string;
  senderName?: string;
  paymentDate?: string;
}

export interface IGmbOrder {
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

  // Manual payment
  transactionDetails?: ITransactionDetails;
  paymentScreenshot?: string; // stored file path after upload

  // Order status
  orderStatus: TOrderStatus;
  createdAt?: Date;
}
