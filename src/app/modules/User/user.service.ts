import httpStatus from 'http-status';
import { User, generateUniqueUserCode } from './user.model';
import { IUser, IUserResponse, UserRole, UserStatus } from './user.interface';
import AppError from '../../errors/AppError';

type TUserListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Get all users (Admin only) — searchable + filterable + paginated.
const getAllUsersFromDB = async (
  query: Record<string, unknown> = {},
): Promise<{ data: IUserResponse[]; meta: TUserListMeta }> => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.search && String(query.search).trim()) {
    const term = String(query.search).trim();
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
      { userCode: { $regex: term, $options: 'i' } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  return {
    data: users as unknown as IUserResponse[],
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Backfill unique 6-digit codes for any existing users created before the
 * userCode field existed. Idempotent — safe to run on every startup.
 */
const backfillUserCodes = async (): Promise<number> => {
  const usersWithoutCode = await User.find({
    $or: [{ userCode: { $exists: false } }, { userCode: null }],
  }).select('_id');

  let assigned = 0;
  for (const user of usersWithoutCode) {
    const code = await generateUniqueUserCode();
    await User.updateOne({ _id: user._id }, { $set: { userCode: code } });
    assigned += 1;
  }

  if (assigned > 0) {
    console.log(`[Startup] Backfilled userCode for ${assigned} user(s).`);
  }
  return assigned;
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
  const restrictedFields = [
    'email',
    'password',
    'role',
    'isDeleted',
    'status',
    'accountBalance',
  ];
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
  backfillUserCodes,
  getSingleUserFromDB,
  getUserProfile,
  updateUserProfile,
  changePassword,
  updateUserStatus,
  updateUserRole,
  deleteUser,
};
