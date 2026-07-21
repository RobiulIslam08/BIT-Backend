// ============================================
// BIT SOFTWARE — Payment Method Interface
// ============================================
// A saved (vaulted) payment instrument that allows charging a customer
// without them being present — required for domain AUTO-RENEW.

import { Types } from 'mongoose';

export type TPaymentProvider = 'paypal';
export type TPaymentMethodStatus = 'active' | 'removed';

export interface IPaymentMethod {
  userId: Types.ObjectId;
  provider: TPaymentProvider;
  vaultId: string; // provider-side reusable token id
  customerId?: string; // PayPal customer id (vault)
  label: string; // human friendly, e.g. masked email
  email?: string; // PayPal account email (masked before returning to client)
  isDefault: boolean;
  status: TPaymentMethodStatus;
  createdAt?: Date;
  updatedAt?: Date;
}
