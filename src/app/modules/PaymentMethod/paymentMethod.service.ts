// ============================================
// BIT SOFTWARE — Payment Method Service
// ============================================
// Save / list / default / delete PayPal vault tokens for domain auto-renew.

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { PaymentMethod } from './paymentMethod.model';
import { IPaymentMethod } from './paymentMethod.interface';
import {
  createVaultSetupToken,
  createVaultPaymentToken,
  deleteVaultPaymentToken,
} from '../../utils/paypal';

const maskEmail = (email?: string): string => {
  if (!email) return 'PayPal account';
  const [name, domain] = email.split('@');
  if (!domain) return 'PayPal account';
  const visible = name.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
};

const sanitize = (pm: IPaymentMethod & { _id?: unknown }) => ({
  _id: pm._id,
  provider: pm.provider,
  label: pm.label,
  isDefault: pm.isDefault,
  status: pm.status,
  createdAt: pm.createdAt,
});

/**
 * Step 1: create a PayPal vault setup token for the frontend to approve.
 */
export const createSetupToken = async (): Promise<{ setupToken: string }> => {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  try {
    const setup = await createVaultSetupToken(
      `${frontendUrl}/my-account?tab=billing&vault=success`,
      `${frontendUrl}/my-account?tab=billing&vault=cancel`,
    );
    if (!setup?.id) {
      throw new AppError(httpStatus.BAD_GATEWAY, 'Could not start saving the payment method.');
    }
    return { setupToken: setup.id };
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      err?.message || 'Could not start saving the payment method. Please try again.',
    );
  }
};

/**
 * Step 2: exchange an approved setup token for a reusable vault token and store it.
 */
export const savePaymentMethod = async (userId: string, setupTokenId: string) => {
  const token = String(setupTokenId || '').trim();
  if (!token) {
    throw new AppError(httpStatus.BAD_REQUEST, 'setupToken is required.');
  }

  let vaultId: string;
  let email: string | undefined;
  let customerId: string | undefined;

  try {
    const result = await createVaultPaymentToken(token);
    vaultId = result.vaultId;
    email = result.email;
    customerId = result.customerId;
  } catch (err: any) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      err?.message || 'Could not save the payment method. Please try again.',
    );
  }

  if (!vaultId) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Could not save the payment method.');
  }

  const userOid = new mongoose.Types.ObjectId(userId);

  // Same vault token already stored (idempotent retry).
  const byVault = await PaymentMethod.findOne({ vaultId });
  if (byVault) {
    // If it belongs to this user and was soft-removed, reactivate.
    if (String(byVault.userId) === userId && byVault.status !== 'active') {
      byVault.status = 'active';
      byVault.label = maskEmail(email || byVault.email);
      if (email) byVault.email = email;
      if (customerId) byVault.customerId = customerId;
      const activeCount = await PaymentMethod.countDocuments({ userId: userOid, status: 'active' });
      if (activeCount === 0) byVault.isDefault = true;
      await byVault.save();
      return sanitize(byVault.toObject() as IPaymentMethod & { _id?: unknown });
    }
    if (String(byVault.userId) === userId) {
      return sanitize(byVault.toObject() as IPaymentMethod & { _id?: unknown });
    }
    throw new AppError(httpStatus.CONFLICT, 'This payment method is already saved on another account.');
  }

  // Same PayPal email already active for this user → treat as duplicate.
  if (email) {
    const byEmail = await PaymentMethod.findOne({
      userId: userOid,
      email: email.toLowerCase(),
      status: 'active',
      provider: 'paypal',
    });
    if (byEmail) {
      // Update vault id if PayPal issued a new token for the same account.
      byEmail.vaultId = vaultId;
      if (customerId) byEmail.customerId = customerId;
      byEmail.label = maskEmail(email);
      await byEmail.save();
      return sanitize(byEmail.toObject() as IPaymentMethod & { _id?: unknown });
    }
  }

  const activeCount = await PaymentMethod.countDocuments({
    userId: userOid,
    status: 'active',
  });

  const created = await PaymentMethod.create({
    userId: userOid,
    provider: 'paypal',
    vaultId,
    customerId,
    email,
    label: maskEmail(email),
    isDefault: activeCount === 0,
    status: 'active',
  });

  return sanitize(created.toObject() as IPaymentMethod & { _id?: unknown });
};

/**
 * List a user's active saved payment methods (sanitized).
 */
export const getUserPaymentMethods = async (userId: string) => {
  const methods = await PaymentMethod.find({
    userId: new mongoose.Types.ObjectId(userId),
    status: 'active',
  })
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();
  return methods.map((m) => sanitize(m as IPaymentMethod & { _id?: unknown }));
};

/**
 * Set a payment method as the default (unset others).
 */
export const setDefaultPaymentMethod = async (userId: string, methodId: string) => {
  if (!mongoose.isValidObjectId(methodId)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid payment method id.');
  }

  const method = await PaymentMethod.findOne({
    _id: methodId,
    userId: new mongoose.Types.ObjectId(userId),
    status: 'active',
  });
  if (!method) throw new AppError(httpStatus.NOT_FOUND, 'Payment method not found.');

  await PaymentMethod.updateMany(
    { userId: new mongoose.Types.ObjectId(userId), status: 'active' },
    { $set: { isDefault: false } },
  );
  method.isDefault = true;
  await method.save();
  return sanitize(method.toObject() as IPaymentMethod & { _id?: unknown });
};

/**
 * Remove a saved payment method (also revokes it at the provider).
 */
export const deletePaymentMethod = async (userId: string, methodId: string) => {
  if (!mongoose.isValidObjectId(methodId)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid payment method id.');
  }

  const method = await PaymentMethod.findOne({
    _id: methodId,
    userId: new mongoose.Types.ObjectId(userId),
    status: 'active',
  });
  if (!method) throw new AppError(httpStatus.NOT_FOUND, 'Payment method not found.');

  const wasDefault = method.isDefault;

  await deleteVaultPaymentToken(method.vaultId);

  method.status = 'removed';
  method.isDefault = false;
  await method.save();

  if (wasDefault) {
    const remaining = await PaymentMethod.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      status: 'active',
    }).sort({ createdAt: -1 });
    if (remaining) {
      remaining.isDefault = true;
      await remaining.save();
    }
  }

  return { removed: true };
};

/**
 * Internal: get a user's default active payment method (full doc, incl. vaultId).
 * Falls back to any active method if none is marked default.
 */
export const getDefaultPaymentMethodDoc = async (userId: mongoose.Types.ObjectId) => {
  const preferred = await PaymentMethod.findOne({
    userId,
    status: 'active',
    isDefault: true,
  }).lean();
  if (preferred) return preferred;

  return PaymentMethod.findOne({
    userId,
    status: 'active',
  })
    .sort({ createdAt: -1 })
    .lean();
};
