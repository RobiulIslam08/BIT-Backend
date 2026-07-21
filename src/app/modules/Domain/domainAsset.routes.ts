// ============================================
// BIT SOFTWARE — Domain Asset Routes  (/api/v1/domains)
// ============================================

import express from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import { DomainControllers } from './domainAsset.controller';
import { DomainValidation } from './domainAsset.validation';

const router = express.Router();

const renewLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many renewal attempts. Please wait 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// ─── SYSTEM: auto-renew engine ───
// Cron endpoint supports GET (Vercel Cron) and POST, secured by CRON_SECRET.
router.get('/renewal-engine/cron', DomainControllers.runRenewalEngineCron);
router.post('/renewal-engine/cron', DomainControllers.runRenewalEngineCron);
router.post('/renewal-engine/run', auth('admin'), DomainControllers.runRenewalEngineAdmin);

// ─── ADMIN: user picker (must precede '/:id') ───
router.get('/admin/users', auth('admin'), DomainControllers.searchUsers);

// ─── USER: own domains ───
router.get('/my', auth('user', 'admin'), DomainControllers.getMyDomains);
router.post('/my/renew/complete', auth('user', 'admin'), renewLimit, DomainControllers.completeRenew);
router.get('/my/:id', auth('user', 'admin'), DomainControllers.getMyDomainById);
router.patch(
  '/my/:id/auto-renew',
  auth('user', 'admin'),
  validateRequest(DomainValidation.toggleAutoRenewValidationSchema),
  DomainControllers.toggleAutoRenew,
);
router.post(
  '/my/:id/renew/create-order',
  auth('user', 'admin'),
  renewLimit,
  DomainControllers.createRenewOrder,
);

// ─── ADMIN: CRUD ───
router.get('/', auth('admin'), DomainControllers.getAllDomains);
router.post(
  '/',
  auth('admin'),
  validateRequest(DomainValidation.createDomainValidationSchema),
  DomainControllers.createDomain,
);
router.get('/:id', auth('admin'), DomainControllers.getDomainByIdAdmin);
router.patch(
  '/:id',
  auth('admin'),
  validateRequest(DomainValidation.updateDomainValidationSchema),
  DomainControllers.updateDomain,
);
router.delete('/:id', auth('admin'), DomainControllers.deleteDomain);

export const DomainAssetRoutes = router;
