// ============================================
// BIT SOFTWARE — Visitor Activity Routes
// ============================================
//   POST /api/v1/activity/page-view   — public (+ optionalAuth)
//   POST /api/v1/activity/heartbeat   — public (+ optionalAuth)
//   POST /api/v1/activity/leave       — public (tab close / leave site)
//   GET  /api/v1/activity/live        — admin live visitors
//   GET  /api/v1/activity/sessions    — admin paginated history
//   GET  /api/v1/activity/sessions/:id — admin session detail

import express from 'express';
import rateLimit from 'express-rate-limit';
import auth, { optionalAuth } from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import { VisitorActivityControllers } from './visitorActivity.controller';
import { VisitorActivityValidation } from './visitorActivity.validation';

const router = express.Router();

const ingestRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many activity events. Please wait a moment.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post(
  '/page-view',
  ingestRateLimit,
  optionalAuth,
  validateRequest(VisitorActivityValidation.pageViewValidationSchema),
  VisitorActivityControllers.recordPageView,
);

router.post(
  '/heartbeat',
  ingestRateLimit,
  optionalAuth,
  validateRequest(VisitorActivityValidation.heartbeatValidationSchema),
  VisitorActivityControllers.recordHeartbeat,
);

router.post(
  '/leave',
  ingestRateLimit,
  validateRequest(VisitorActivityValidation.leaveValidationSchema),
  VisitorActivityControllers.recordLeave,
);

router.post(
  '/event',
  ingestRateLimit,
  optionalAuth,
  validateRequest(VisitorActivityValidation.eventValidationSchema),
  VisitorActivityControllers.recordEvent,
);

router.get('/live', auth('admin'), VisitorActivityControllers.getLiveSessions);
router.get('/sessions', auth('admin'), VisitorActivityControllers.getSessions);
router.get('/sessions/:id', auth('admin'), VisitorActivityControllers.getSessionById);

export const VisitorActivityRoutes = router;
