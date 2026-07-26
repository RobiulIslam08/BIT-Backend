// ============================================
// BIT SOFTWARE — Cart Checkout Routes
// ============================================
//   POST /api/v1/cart/create-paypal-order
//   POST /api/v1/cart/complete-purchase
//   POST /api/v1/cart/pay-with-wallet

import express from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import { CartControllers } from './cart.controller';
import { CartValidation } from './cart.validation';

const router = express.Router();

const purchaseLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many purchase attempts. Please wait 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

const completePurchaseLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many completion attempts. Please wait 5 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post(
  '/create-paypal-order',
  auth('user', 'admin'),
  purchaseLimit,
  validateRequest(CartValidation.createPayPalOrder),
  CartControllers.createPayPalOrder,
);

router.post(
  '/complete-purchase',
  auth('user', 'admin'),
  completePurchaseLimit,
  validateRequest(CartValidation.completePurchase),
  CartControllers.completePurchase,
);

router.post(
  '/pay-with-wallet',
  auth('user', 'admin'),
  purchaseLimit,
  validateRequest(CartValidation.payWithWallet),
  CartControllers.payWithWallet,
);

export const CartRoutes = router;
