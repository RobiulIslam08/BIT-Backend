import express from 'express';
import { UserController } from './user.controller';
import validateRequest from '../../middleware/validationRequest';
import { UserValidation } from './user.validation';
// import auth from '../../middleware/auth';
// import { UserRole } from './user.interface';

const router = express.Router();

// Get all users (Admin only)
router.get(
  '/',
  // auth(UserRole.ADMIN), // Uncomment when auth middleware is ready
  UserController.getAllUsers,
);

// Get my profile (Authenticated user)
router.get(
  '/me',
  // auth(UserRole.USER, UserRole.ADMIN), // Uncomment when auth middleware is ready
  UserController.getMyProfile,
);

// Update my profile (Authenticated user)
router.patch(
  '/me',
  // auth(UserRole.USER, UserRole.ADMIN), // Uncomment when auth middleware is ready
  validateRequest(UserValidation.updateUserValidationSchema),
  UserController.updateMyProfile,
);

// Change password (Authenticated user)
router.post(
  '/change-password',
  // auth(UserRole.USER, UserRole.ADMIN), // Uncomment when auth middleware is ready
  validateRequest(UserValidation.changePasswordValidationSchema),
  UserController.changePassword,
);

// Get single user by ID (Admin only)
router.get(
  '/:id',
  // auth(UserRole.ADMIN), // Uncomment when auth middleware is ready
  UserController.getSingleUser,
);

// Update user status (Admin only)
router.patch(
  '/:id/status',
  // auth(UserRole.ADMIN), // Uncomment when auth middleware is ready
  validateRequest(UserValidation.updateUserStatusValidationSchema),
  UserController.updateUserStatus,
);

// Update user role (Admin only)
router.patch(
  '/:id/role',
  // auth(UserRole.ADMIN), // Uncomment when auth middleware is ready
  validateRequest(UserValidation.updateUserRoleValidationSchema),
  UserController.updateUserRole,
);

// Delete user (Admin only)
router.delete(
  '/:id',
  // auth(UserRole.ADMIN), // Uncomment when auth middleware is ready
  UserController.deleteUser,
);

export const UserRoutes = router;
