import { z } from 'zod';
import { UserRole, UserStatus } from './user.interface';

// Create User Validation Schema
const createUserValidationSchema = z.object({
  body: z.object({
    name: z
      .string({ message: 'Name is required' })
      .min(2, { message: 'Name must be at least 2 characters' })
      .max(100, { message: 'Name cannot exceed 100 characters' })
      .trim(),
    email: z
      .string({ message: 'Email is required' })
      .email({ message: 'Invalid email address' })
      .toLowerCase()
      .trim(),
    password: z
      .string({ message: 'Password is required' })
      .min(6, { message: 'Password must be at least 6 characters' })
      .max(100, { message: 'Password cannot exceed 100 characters' }),
    role: z.nativeEnum(UserRole).optional().default(UserRole.USER),
    phone: z.string().trim().optional(),
    address: z.string().trim().optional(),
    profileImage: z.string().url().optional(),
  }),
});

// Update User Validation Schema
const updateUserValidationSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(2, { message: 'Name must be at least 2 characters' })
      .max(100, { message: 'Name cannot exceed 100 characters' })
      .trim()
      .optional(),
    phone: z.string().trim().optional(),
    address: z.string().trim().optional(),
    profileImage: z.string().url().optional(),
  }),
});

// Change Password Validation Schema
const changePasswordValidationSchema = z.object({
  body: z.object({
    oldPassword: z.string({ message: 'Old password is required' }),
    newPassword: z
      .string({ message: 'New password is required' })
      .min(6, { message: 'Password must be at least 6 characters' })
      .max(100, { message: 'Password cannot exceed 100 characters' }),
  }),
});

// Update User Status Validation Schema (Admin only)
const updateUserStatusValidationSchema = z.object({
  body: z.object({
    status: z.nativeEnum(UserStatus, {
      message: 'Status must be either active or blocked',
    }),
  }),
});

// Update User Role Validation Schema (Admin only)
const updateUserRoleValidationSchema = z.object({
  body: z.object({
    role: z.nativeEnum(UserRole, {
      message: 'Role must be either user or admin',
    }),
  }),
});

export const UserValidation = {
  createUserValidationSchema,
  updateUserValidationSchema,
  changePasswordValidationSchema,
  updateUserStatusValidationSchema,
  updateUserRoleValidationSchema,
};
