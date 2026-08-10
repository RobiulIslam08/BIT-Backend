// ============================================
// BIT SOFTWARE — GMB Profile Asset Routes  (/api/v1/gmb-profiles)
// ============================================

import express from 'express';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import { GmbProfileControllers } from './gmbProfile.controller';
import { GmbProfileValidation } from './gmbProfile.validation';

const router = express.Router();

// ─── ADMIN: user picker ───
router.get('/admin/users', auth('admin'), GmbProfileControllers.searchUsers);

// ─── USER: own profiles ───
router.get('/my', auth('user', 'admin'), GmbProfileControllers.getMyGmbProfiles);
router.get('/my/:id', auth('user', 'admin'), GmbProfileControllers.getMyGmbProfileById);

// ─── ADMIN: CRUD ───
router.get('/', auth('admin'), GmbProfileControllers.getAllGmbProfiles);
router.post(
  '/',
  auth('admin'),
  validateRequest(GmbProfileValidation.createGmbProfileValidationSchema),
  GmbProfileControllers.createGmbProfile,
);
router.get('/:id', auth('admin'), GmbProfileControllers.getGmbProfileByIdAdmin);
router.patch(
  '/:id',
  auth('admin'),
  validateRequest(GmbProfileValidation.updateGmbProfileValidationSchema),
  GmbProfileControllers.updateGmbProfile,
);
router.delete('/:id', auth('admin'), GmbProfileControllers.deleteGmbProfile);

export const GmbProfileRoutes = router;
