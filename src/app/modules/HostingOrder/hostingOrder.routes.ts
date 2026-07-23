// ============================================
// BIT SOFTWARE — Hosting Order Routes
// ============================================

import express from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../../middleware/auth';
import { HostingOrderControllers } from './hostingOrder.controller';

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

router.get('/exchange-rates', HostingOrderControllers.getExchangeRates);

router.post(
  '/create-paypal-order',
  auth('user', 'admin'),
  purchaseLimit,
  HostingOrderControllers.createPayPalOrder,
);

router.post(
  '/complete-purchase',
  auth('user', 'admin'),
  completePurchaseLimit,
  HostingOrderControllers.completePurchase,
);

router.post(
  '/pay-with-wallet',
  auth('user', 'admin'),
  purchaseLimit,
  HostingOrderControllers.payWithWallet,
);

router.get('/my', auth('user', 'admin'), HostingOrderControllers.getMyOrders);
router.get('/:id', auth('user', 'admin'), HostingOrderControllers.getOrderById);

router.get('/', auth('admin'), HostingOrderControllers.getAllOrders);
router.patch('/:id', auth('admin'), HostingOrderControllers.updateOrderStatus);

export const HostingOrderRoutes = router;
