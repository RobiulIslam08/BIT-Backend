import { Request, Response } from 'express';
import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { UserService } from './user.service';
import { UserRole, UserStatus } from './user.interface';

// Get all users (Admin only)
const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await UserService.getAllUsersFromDB(
    req.query as Record<string, unknown>,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Users retrieved successfully',
    meta: {
      page: meta.page,
      limit: meta.limit,
      total: meta.total,
      totalPage: meta.totalPages,
    },
    data,
  });
});

// Get single user by ID
const getSingleUser = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await UserService.getSingleUserFromDB(id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User retrieved successfully',
    data: result,
  });
});

// Get user profile (current logged-in user)
const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.userId; // Corrected from req.user?.id
  const result = await UserService.getUserProfile(userId as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Profile retrieved successfully',
    data: result,
  });
});

// Update user profile
const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.userId; // Corrected from req.user?.id
  const result = await UserService.updateUserProfile(userId as string, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Profile updated successfully',
    data: result,
  });
});

// Change password
const changePassword = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.userId; // Corrected from req.user?.id
  const { oldPassword, newPassword } = req.body;

  await UserService.changePassword(userId as string, oldPassword, newPassword);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Password changed successfully',
    data: null,
  });
});

// Update user status (Admin only)
const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const result = await UserService.updateUserStatus(id as string, status as UserStatus);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User status updated successfully',
    data: result,
  });
});

// Update user role (Admin only)
const updateUserRole = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { role } = req.body;

  const result = await UserService.updateUserRole(id as string, role as UserRole);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User role updated successfully',
    data: result,
  });
});

// Delete user (Soft delete)
const deleteUser = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  await UserService.deleteUser(id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User deleted successfully',
    data: null,
  });
});

export const UserController = {
  getAllUsers,
  getSingleUser,
  getMyProfile,
  updateMyProfile,
  changePassword,
  updateUserStatus,
  updateUserRole,
  deleteUser,
};
