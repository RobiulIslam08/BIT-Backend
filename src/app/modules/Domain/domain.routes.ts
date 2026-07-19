// ============================================
// BIT SOFTWARE — Domain Routes
// ============================================

import express from 'express';
import rateLimit from 'express-rate-limit';
import { DomainControllers } from './domain.controller';

const router = express.Router();

// Rate limit: 10 domain checks per minute per IP (prevent abuse)
const domainCheckRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many domain searches. Please wait a moment and try again.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// POST /api/v1/domain/check
router.post('/check', domainCheckRateLimit, DomainControllers.checkDomain);

export const DomainRoutes = router;
