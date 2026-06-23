import { z } from 'zod';

// Register Validation Schema
const registerValidationSchema = z.object({
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
    phone: z.string().trim().optional(),
    address: z.string().trim().optional(),
  }),
});

// Login Validation Schema
const loginValidationSchema = z.object({
  body: z.object({
    email: z
      .string({ message: 'Email is required' })
      .email({ message: 'Invalid email address' }),
    password: z.string({ message: 'Password is required' }),
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

// Refresh Token Validation Schema
const refreshTokenValidationSchema = z.object({
  cookies: z.object({
    refreshToken: z.string({
      message: 'Refresh token is required',
    }),
  }),
});

// Forget Password Validation Schema
const forgetPasswordValidationSchema = z.object({
  body: z.object({
    email: z
      .string({ message: 'Email is required' })
      .email({ message: 'Invalid email address' }),
  }),
});

// Reset Password Validation Schema
const resetPasswordValidationSchema = z.object({
  body: z.object({
    email: z
      .string({ message: 'Email is required' })
      .email({ message: 'Invalid email address' }),
    newPassword: z
      .string({ message: 'New password is required' })
      .min(6, { message: 'Password must be at least 6 characters' }),
  }),
});

export const AuthValidation = {
  registerValidationSchema,
  loginValidationSchema,
  changePasswordValidationSchema,
  refreshTokenValidationSchema,
  forgetPasswordValidationSchema,
  resetPasswordValidationSchema,
};
