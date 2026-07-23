// ============================================
// BIT SOFTWARE — Wallet Interfaces & Types
// ============================================

import { Types } from 'mongoose';

// A wallet transaction (ledger row). All monetary values are in USD.
// accountAmount / promoAmount are SIGNED: positive = credited to the user,
// negative = debited from the user.
export type TWalletTxnType =
  | 'topup' // customer deposited money via PayPal (to accountBalance)
  | 'purchase' // spent on a service (from promo first, then account)
  | 'refund' // service fulfillment failed → money returned to wallet
  | 'bonus_credit' // admin gifted promotional credit
  | 'withdrawal' // customer withdrew account balance (funds held/removed)
  | 'withdrawal_reversal' // admin rejected a withdrawal → funds returned
  | 'adjustment'; // manual admin correction

export type TWalletTxnStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type TWalletRefKind =
  | 'domain_order'
  | 'hosting_order'
  | 'gmb_order'
  | 'domain_renewal'
  | 'paypal_topup'
  | 'withdrawal'
  | 'admin';

export interface IWalletTxnReference {
  kind?: TWalletRefKind;
  id?: string;
}

export interface IWalletTransaction {
  userId: Types.ObjectId;
  type: TWalletTxnType;
  status: TWalletTxnStatus;

  // Signed changes applied to each balance (USD).
  accountAmount: number;
  promoAmount: number;
  // Absolute display total = |accountAmount| + |promoAmount|.
  amount: number;

  // Top-up specific breakdown.
  grossUSD?: number; // what the customer paid to PayPal (lands fully in our account)
  feeUSD?: number; // fee retained by the business (revenue)
  netUSD?: number; // amount actually credited to the wallet

  // Balance snapshot AFTER this transaction completed.
  balanceAfterAccount?: number;
  balanceAfterPromo?: number;

  reference?: IWalletTxnReference;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  note?: string;
  createdBy?: Types.ObjectId; // admin who performed a grant/adjustment

  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Withdrawals ───
export type TWithdrawalMethod = 'bank' | 'bkash' | 'nagad' | 'paypal';
export type TWithdrawalStatus = 'pending' | 'completed' | 'rejected';

export interface IWithdrawalDetails {
  // Bank
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  routingNumber?: string;
  branch?: string;
  // Mobile wallet (bKash / Nagad)
  walletNumber?: string;
  // PayPal
  paypalEmail?: string;
}

export interface IWithdrawal {
  userId: Types.ObjectId;
  amountUSD: number; // whole USD only
  method: TWithdrawalMethod;
  details: IWithdrawalDetails;
  status: TWithdrawalStatus;
  walletTransactionId?: Types.ObjectId;
  adminNote?: string;
  payoutRef?: string; // external transfer reference set by admin on completion
  processedBy?: Types.ObjectId;
  processedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Settings (singleton) ───
export interface IWalletSettings {
  key: string; // always 'default'
  topupFeePercent: number; // e.g. 5 → 5%
  minTopupUSD: number; // minimum top-up amount in USD
  updatedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}
