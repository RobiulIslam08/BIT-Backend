import httpStatus from 'http-status';
import jwt, { JwtPayload } from 'jsonwebtoken';
import config from '../../config';
import AppError from '../../errors/AppError';
import {
  IRegister,
  ILogin,
  IChangePassword,
  IAuthResponse,
} from './auth.interface';
import { createToken } from './auth.utils';
import { User } from '../User/user.model';

// ==================== REGISTRATION ====================
const registerUser = async (payload: IRegister): Promise<IAuthResponse> => {
  // Check if user already exists
  const existingUser = await User.findOne({ email: payload.email });

  if (existingUser) {
    throw new AppError(
      httpStatus.CONFLICT,
      'User with this email already exists',
    );
  }

  // Create new user
  const newUser = await User.create(payload);

  // Create JWT payload
  const jwtPayload = {
    userId: newUser._id.toString(),
    role: newUser.role,
  };

  // Generate tokens
  const accessToken = createToken(
    jwtPayload,
    config.jwt_access_secret as string,
    config.jwt_access_expires_in as string,
  );

  const refreshToken = createToken(
    jwtPayload,
    config.jwt_refresh_secret as string,
    config.jwt_refresh_expires_in as string,
  );

  return {
    accessToken,
    refreshToken,
    user: {
      _id: newUser._id.toString(),
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
    },
  };
};

// ==================== LOGIN ====================
const loginUser = async (payload: ILogin): Promise<IAuthResponse> => {
  // Check if user exists
  const user = await User.isUserExistsByEmail(payload.email);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Check if user is deleted
  if (User.isUserDeleted(user)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user has been deleted');
  }

  // Check if user is blocked
  if (User.isUserBlocked(user)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user is blocked');
  }

  // Check if password is correct
  const isPasswordMatched = await user.comparePassword(payload.password);

  if (!isPasswordMatched) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid email or password');
  }

  // Create JWT payload
  const jwtPayload = {
    userId: user._id.toString(),
    role: user.role,
  };

  // Generate tokens
  const accessToken = createToken(
    jwtPayload,
    config.jwt_access_secret as string,
    config.jwt_access_expires_in as string,
  );

  const refreshToken = createToken(
    jwtPayload,
    config.jwt_refresh_secret as string,
    config.jwt_refresh_expires_in as string,
  );

  return {
    accessToken,
    refreshToken,
    user: {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
};

// ==================== CHANGE PASSWORD ====================
const changePassword = async (
  userData: JwtPayload,
  payload: IChangePassword,
): Promise<void> => {
  // Get user by ID from JWT payload
  const user = await User.findById(userData.userId).select('+password');

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Check if user is deleted
  if (User.isUserDeleted(user)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user has been deleted');
  }

  // Check if user is blocked
  if (User.isUserBlocked(user)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user is blocked');
  }

  // Verify old password
  const isPasswordMatched = await user.comparePassword(payload.oldPassword);

  if (!isPasswordMatched) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Old password is incorrect');
  }

  // Update password (model middleware will hash it)
  user.password = payload.newPassword;
  await user.save();
};

// ==================== REFRESH TOKEN ====================
const refreshToken = async (token: string) => {
  // Verify refresh token
  if (!token) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Refresh token is required');
  }

  const decoded = jwt.verify(
    token,
    config.jwt_refresh_secret as string,
  ) as JwtPayload;

  const { userId } = decoded;

  // Check if user exists
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Check if user is deleted
  if (User.isUserDeleted(user)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user has been deleted');
  }

  // Check if user is blocked
  if (User.isUserBlocked(user)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user is blocked');
  }

  // Generate new access token
  const jwtPayload = {
    userId: user._id.toString(),
    role: user.role,
  };

  const accessToken = createToken(
    jwtPayload,
    config.jwt_access_secret as string,
    config.jwt_access_expires_in as string,
  );

  return {
    accessToken,
  };
};

// ==================== FORGET PASSWORD ====================
const forgetPassword = async (email: string): Promise<void> => {
  // Check if user exists by email
  const user = await User.findOne({ email });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Check if user is deleted
  if (User.isUserDeleted(user)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user has been deleted');
  }

  // Check if user is blocked
  if (User.isUserBlocked(user)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user is blocked');
  }

  // Create JWT payload for reset token
  const jwtPayload = {
    userId: user._id.toString(),
    role: user.role,
  };

  // Generate reset token (valid for 10 minutes)
  const resetToken = createToken(
    jwtPayload,
    config.jwt_access_secret as string,
    '10m',
  );

  // Create reset link
  const resetUILink = `${config.reset_pass_ui_link}?email=${user.email}&token=${resetToken}`;

  // TODO: Send email with reset link
  // sendEmail(user.email, resetUILink);

  console.log('Password reset link:', resetUILink);
};

// ==================== RESET PASSWORD ====================
const resetPassword = async (
  payload: { email: string; newPassword: string },
  token: string,
): Promise<void> => {
  // Verify token
  if (!token) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Token is required');
  }

  let actualToken = token;
  if (token.startsWith('Bearer ')) {
    actualToken = token.split(' ')[1];
  }

  const decoded = jwt.verify(
    actualToken,
    config.jwt_access_secret as string,
  ) as JwtPayload;

  // Check if user exists
  const user = await User.findOne({ email: payload.email }).select('+password');

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Verify token belongs to this user
  if (user._id.toString() !== decoded.userId) {
    throw new AppError(httpStatus.FORBIDDEN, 'Invalid token');
  }

  // Check if user is deleted
  if (User.isUserDeleted(user)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user has been deleted');
  }

  // Check if user is blocked
  if (User.isUserBlocked(user)) {
    throw new AppError(httpStatus.FORBIDDEN, 'This user is blocked');
  }

  // Update password (model middleware will hash it)
  user.password = payload.newPassword;
  await user.save();
};

export const AuthServices = {
  registerUser,
  loginUser,
  changePassword,
  refreshToken,
  forgetPassword,
  resetPassword,
};
