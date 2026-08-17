// ============================================
// BIT SOFTWARE — Email Plan Routes  (/api/v1/email-plans)
// ============================================

import express from 'express';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import { EmailPlanControllers } from './emailPlan.controller';
import { EmailPlanValidation } from './emailPlan.validation';

const router = express.Router();

router.get('/public', EmailPlanControllers.getPublicPlans);

router.get('/', auth('admin'), EmailPlanControllers.getAllPlans);
router.post(
  '/',
  auth('admin'),
  validateRequest(EmailPlanValidation.createPlanValidationSchema),
  EmailPlanControllers.createPlan,
);
router.patch(
  '/:id',
  auth('admin'),
  validateRequest(EmailPlanValidation.updatePlanValidationSchema),
  EmailPlanControllers.updatePlan,
);
router.delete('/:id', auth('admin'), EmailPlanControllers.deletePlan);

export const EmailPlanRoutes = router;
