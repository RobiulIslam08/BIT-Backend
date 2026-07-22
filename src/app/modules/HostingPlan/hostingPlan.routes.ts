// ============================================
// BIT SOFTWARE — Hosting Plan Routes  (/api/v1/hosting-plans)
// ============================================

import express from 'express';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import { HostingPlanControllers } from './hostingPlan.controller';
import { HostingPlanValidation } from './hostingPlan.validation';

const router = express.Router();

// Public catalog for website / checkout
router.get('/public', HostingPlanControllers.getPublicPlans);

// Admin CRUD
router.get('/', auth('admin'), HostingPlanControllers.getAllPlans);
router.post(
  '/',
  auth('admin'),
  validateRequest(HostingPlanValidation.createPlanValidationSchema),
  HostingPlanControllers.createPlan,
);
router.patch(
  '/:id',
  auth('admin'),
  validateRequest(HostingPlanValidation.updatePlanValidationSchema),
  HostingPlanControllers.updatePlan,
);
router.delete('/:id', auth('admin'), HostingPlanControllers.deletePlan);

export const HostingPlanRoutes = router;
