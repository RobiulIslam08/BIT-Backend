// ============================================
// BIT SOFTWARE — Domain Pricing Routes
// ============================================
//   GET  /api/v1/domain-pricing/public   — public (website / checkout)
//   GET  /api/v1/domain-pricing         — admin list
//   POST /api/v1/domain-pricing         — admin create
//   PATCH /api/v1/domain-pricing/:id    — admin update
//   DELETE /api/v1/domain-pricing/:id   — admin delete
//   PUT  /api/v1/domain-pricing/bulk    — admin bulk upsert

import express from 'express';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import { DomainPricingControllers } from './domainPricing.controller';
import { DomainPricingValidation } from './domainPricing.validation';

const router = express.Router();

// Public — used by Domain Hosting page + checkout UI
router.get('/public', DomainPricingControllers.getPublicPricing);

// Admin
router.get('/', auth('admin'), DomainPricingControllers.getAllPricing);
router.put(
  '/bulk',
  auth('admin'),
  validateRequest(DomainPricingValidation.bulkUpdateDomainPricingValidationSchema),
  DomainPricingControllers.bulkUpsertPricing,
);
router.post(
  '/',
  auth('admin'),
  validateRequest(DomainPricingValidation.createDomainPricingValidationSchema),
  DomainPricingControllers.createPricing,
);
router.patch(
  '/:id',
  auth('admin'),
  validateRequest(DomainPricingValidation.updateDomainPricingValidationSchema),
  DomainPricingControllers.updatePricing,
);
router.delete('/:id', auth('admin'), DomainPricingControllers.deletePricing);

export const DomainPricingRoutes = router;
