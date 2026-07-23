// ============================================
// BIT SOFTWARE — Wallet Routes
// ============================================
//   Customer:
//     GET   /api/v1/wallet/summary
//     GET   /api/v1/wallet/transactions
//     POST  /api/v1/wallet/topup/create-paypal-order
//     POST  /api/v1/wallet/topup/complete
//     POST  /api/v1/wallet/withdrawals
//     GET   /api/v1/wallet/withdrawals
//   Admin:
//     GET   /api/v1/wallet/settings
//     PATCH /api/v1/wallet/settings
//     POST  /api/v1/wallet/admin/grant-credit
//     POST  /api/v1/wallet/admin/adjust
//     GET   /api/v1/wallet/admin/withdrawals
//     PATCH /api/v1/wallet/admin/withdrawals/:id
//     GET   /api/v1/wallet/admin/users/:id/transactions

import express from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import { WalletControllers } from './wallet.controller';
import { WalletValidation } from './wallet.validation';
import { UserRole } from '../User/user.interface';

const router = express.Router();

const topupLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many top-up attempts. Please wait 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

const withdrawalLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many withdrawal requests. Please wait a while.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// ─── Customer ───
router.get('/summary', auth(UserRole.USER, UserRole.ADMIN), WalletControllers.getSummary);
router.get('/transactions', auth(UserRole.USER, UserRole.ADMIN), WalletControllers.getTransactions);

router.post(
  '/topup/create-paypal-order',
  auth(UserRole.USER, UserRole.ADMIN),
  topupLimit,
  validateRequest(WalletValidation.createTopupOrder),
  WalletControllers.createTopupOrder,
);
router.post(
  '/topup/complete',
  auth(UserRole.USER, UserRole.ADMIN),
  validateRequest(WalletValidation.completeTopup),
  WalletControllers.completeTopup,
);

router.post(
  '/withdrawals',
  auth(UserRole.USER, UserRole.ADMIN),
  withdrawalLimit,
  validateRequest(WalletValidation.createWithdrawal),
  WalletControllers.createWithdrawal,
);
router.get('/withdrawals', auth(UserRole.USER, UserRole.ADMIN), WalletControllers.getMyWithdrawals);

// ─── Admin: settings ───
router.get('/settings', auth(UserRole.ADMIN), WalletControllers.getSettings);
router.patch(
  '/settings',
  auth(UserRole.ADMIN),
  validateRequest(WalletValidation.updateSettings),
  WalletControllers.updateSettings,
);

// ─── Admin: credit & adjustments ───
router.post(
  '/admin/grant-credit',
  auth(UserRole.ADMIN),
  validateRequest(WalletValidation.grantCredit),
  WalletControllers.grantCredit,
);
router.post(
  '/admin/adjust',
  auth(UserRole.ADMIN),
  validateRequest(WalletValidation.adjustBalance),
  WalletControllers.adjustBalance,
);

// ─── Admin: withdrawals ───
router.get('/admin/withdrawals', auth(UserRole.ADMIN), WalletControllers.listWithdrawals);
router.patch(
  '/admin/withdrawals/:id',
  auth(UserRole.ADMIN),
  validateRequest(WalletValidation.processWithdrawal),
  WalletControllers.processWithdrawal,
);

// ─── Admin: user transactions ───
router.get(
  '/admin/users/:id/transactions',
  auth(UserRole.ADMIN),
  WalletControllers.getUserTransactions,
);

export const WalletRoutes = router;
