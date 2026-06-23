import httpStatus from 'http-status';
import { User } from './user.model';
import { IUser, IUserResponse, UserRole, UserStatus } from './user.interface';
import AppError from '../../errors/AppError';

// Get all users (Admin only)
const getAllUsersFromDB = async (): Promise<IUserResponse[]> => {
  const users = await User.find();
  return users as unknown as IUserResponse[];
};

// Get single user by ID
const getSingleUserFromDB = async (id: string): Promise<IUserResponse> => {
  const user = await User.findById(id);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  return user as unknown as IUserResponse;
};

// Get user profile (current logged-in user)
const getUserProfile = async (userId: string): Promise<IUserResponse> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  return user as unknown as IUserResponse;
};

// Update user profile
const updateUserProfile = async (
  userId: string,
  payload: Partial<IUser>,
): Promise<IUserResponse> => {
  // Check if user exists
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Prevent updating sensitive fields
  const restrictedFields = ['email', 'password', 'role', 'isDeleted'];
  restrictedFields.forEach((field) => {
    if (field in payload) {
      delete payload[field as keyof IUser];
    }
  });

  // Update user
  const updatedUser = await User.findByIdAndUpdate(userId, payload, {
    new: true,
    runValidators: true,
  });

  if (!updatedUser) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to update user',
    );
  }

  return updatedUser as unknown as IUserResponse;
};

// Change password
const changePassword = async (
  userId: string,
  oldPassword: string,
  newPassword: string,
): Promise<void> => {
  // Get user with password
  const user = await User.findById(userId).select('+password');

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Check if old password is correct
  const isPasswordMatched = await user.comparePassword(oldPassword);

  if (!isPasswordMatched) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Old password is incorrect');
  }

  // Update password
  user.password = newPassword;
  await user.save();
};

// Update user status (Admin only)
const updateUserStatus = async (
  userId: string,
  status: UserStatus,
): Promise<IUserResponse> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  user.status = status;
  await user.save();

  return user as unknown as IUserResponse;
};

// Update user role (Admin only)
const updateUserRole = async (
  userId: string,
  role: UserRole,
): Promise<IUserResponse> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  user.role = role;
  await user.save();

  return user as unknown as IUserResponse;
};

// Delete user (Soft delete)
const deleteUser = async (userId: string): Promise<void> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Soft delete
  user.isDeleted = true;
  await user.save();
};

export const UserService = {
  getAllUsersFromDB,
  getSingleUserFromDB,
  getUserProfile,
  updateUserProfile,
  changePassword,
  updateUserStatus,
  updateUserRole,
  deleteUser,
};
