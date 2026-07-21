// ============================================
// BIT SOFTWARE — Payment Method Routes
// ============================================

import express from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import { PaymentMethodControllers } from './paymentMethod.controller';
import { PaymentMethodValidation } from './paymentMethod.validation';

const router = express.Router();

const vaultLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment-method attempts. Please wait 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// All routes require an authenticated user (customer or admin).
router.post('/setup-token', auth('user', 'admin'), vaultLimit, PaymentMethodControllers.createSetupToken);
router.post(
  '/',
  auth('user', 'admin'),
  vaultLimit,
  validateRequest(PaymentMethodValidation.savePaymentMethodValidationSchema),
  PaymentMethodControllers.savePaymentMethod,
);
router.get('/', auth('user', 'admin'), PaymentMethodControllers.getMyPaymentMethods);
router.patch('/:id/default', auth('user', 'admin'), PaymentMethodControllers.setDefault);
router.delete('/:id', auth('user', 'admin'), PaymentMethodControllers.deletePaymentMethod);

export const PaymentMethodRoutes = router;
