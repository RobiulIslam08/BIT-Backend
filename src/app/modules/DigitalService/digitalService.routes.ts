// ============================================
// BIT SOFTWARE — Digital Service Asset Routes
// ============================================

import express from 'express';
import auth from '../../middleware/auth';
import { DigitalServiceControllers } from './digitalService.controller';

const router = express.Router();

router.get('/catalog', DigitalServiceControllers.getCatalog);

router.get(
  '/trial-eligibility',
  auth('user', 'admin'),
  DigitalServiceControllers.getTrialEligibility,
);

router.get('/my', auth('user', 'admin'), DigitalServiceControllers.getMyServices);
router.get('/my/:id', auth('user', 'admin'), DigitalServiceControllers.getMyServiceById);

router.get('/', auth('admin'), DigitalServiceControllers.getAllServices);
router.get('/:id', auth('admin'), DigitalServiceControllers.getServiceByIdAdmin);
router.patch('/:id', auth('admin'), DigitalServiceControllers.updateService);

export const DigitalServiceRoutes = router;
