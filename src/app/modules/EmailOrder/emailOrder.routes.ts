// ============================================
// BIT SOFTWARE — Email Order Routes
// ============================================

import express from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../../middleware/auth';
import { EmailOrderControllers } from './emailOrder.controller';

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
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many completion attempts. Please wait 5 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.get('/exchange-rates', EmailOrderControllers.getExchangeRates);

router.post(
  '/create-paypal-order',
  auth('user', 'admin'),
  purchaseLimit,
  EmailOrderControllers.createPayPalOrder,
);

router.post(
  '/complete-purchase',
  auth('user', 'admin'),
  completePurchaseLimit,
  EmailOrderControllers.completePurchase,
);

router.post(
  '/pay-with-wallet',
  auth('user', 'admin'),
  purchaseLimit,
  EmailOrderControllers.payWithWallet,
);

router.get('/my', auth('user', 'admin'), EmailOrderControllers.getMyOrders);
router.get('/:id', auth('user', 'admin'), EmailOrderControllers.getOrderById);

router.get('/', auth('admin'), EmailOrderControllers.getAllOrders);
router.patch('/:id', auth('admin'), EmailOrderControllers.updateOrderStatus);

export const EmailOrderRoutes = router;
