// ============================================
// BIT SOFTWARE — Domain Order Routes
// ============================================

import express from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../../middleware/auth';
import { DomainOrderControllers } from './domainOrder.controller';

const router = express.Router();

// ─── Rate Limiters ───
const purchaseLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many purchase attempts. Please wait 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

const completePurchaseLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many completion attempts. Please wait 5 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// ─── PUBLIC ROUTES ───

// Exchange rates (no auth — UI needs this to display prices)
router.get('/exchange-rates', DomainOrderControllers.getExchangeRates);

// ─── USER ROUTES (authenticated) ───

// Create PayPal order (step 1 of checkout)
router.post(
  '/create-paypal-order',
  auth('user', 'admin'),
  purchaseLimit,
  DomainOrderControllers.createPayPalOrder,
);

// Complete purchase after PayPal approval (step 2)
router.post(
  '/complete-purchase',
  auth('user', 'admin'),
  completePurchaseLimit,
  DomainOrderControllers.completePurchase,
);

// Pay for a domain using wallet balance (single step, no PayPal)
router.post(
  '/pay-with-wallet',
  auth('user', 'admin'),
  purchaseLimit,
  DomainOrderControllers.payWithWallet,
);

// Get logged-in user's domains
router.get('/my-domains', auth('user', 'admin'), DomainOrderControllers.getMyDomains);

// Get single order (user: own, admin: any — controller handles distinction)
router.get('/:id', auth('user', 'admin'), DomainOrderControllers.getDomainOrderById);

// ─── ADMIN ROUTES ───

// All orders
router.get('/', auth('admin'), DomainOrderControllers.getAllOrders);

// Manual status update
router.patch('/:id', auth('admin'), DomainOrderControllers.updateOrderStatus);

export const DomainOrderRoutes = router;
