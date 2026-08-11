// ============================================
// BIT SOFTWARE — Digital Service Order Routes
// ============================================

import express from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../../middleware/auth';
import { DigitalServiceOrderControllers } from './digitalServiceOrder.controller';

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
  DigitalServiceOrderControllers.createPayPalOrder,
);

router.post(
  '/complete-purchase',
  auth('user', 'admin'),
  completePurchaseLimit,
  DigitalServiceOrderControllers.completePurchase,
);

router.post(
  '/pay-with-wallet',
  auth('user', 'admin'),
  purchaseLimit,
  DigitalServiceOrderControllers.payWithWallet,
);

router.get('/my', auth('user', 'admin'), DigitalServiceOrderControllers.getMyOrders);
router.get('/:id', auth('user', 'admin'), DigitalServiceOrderControllers.getOrderById);

router.get('/', auth('admin'), DigitalServiceOrderControllers.getAllOrders);
router.patch('/:id', auth('admin'), DigitalServiceOrderControllers.updateOrderStatus);

export const DigitalServiceOrderRoutes = router;
