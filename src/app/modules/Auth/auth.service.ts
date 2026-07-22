import httpStatus from 'http-status';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
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
import { UserRole, UserStatus } from '../User/user.interface';
import { sendEmail } from '../../utils/sendEmail';

const client = new OAuth2Client(config.google_client_id);

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
      profileImage: newUser.profileImage,
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
      profileImage: user.profileImage,
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

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Save OTP to DB
  await User.findByIdAndUpdate(user._id, { otp, otpExpires });

  // Send email with OTP
  const emailHtml = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #4f46e5; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.025em;">Password Reset Request</h2>
      </div>
      <p style="color: #4a5568; font-size: 16px; line-height: 24px; margin-top: 0;">Dear User,</p>
      <p style="color: #4a5568; font-size: 16px; line-height: 24px;">We received a request to reset the password for your account. Please use the following One-Time Password (OTP) to complete the reset process. This OTP is valid for <strong>10 minutes</strong>.</p>
      <div style="text-align: center; margin: 36px 0;">
        <span style="font-family: monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background-color: #f0fdf4; padding: 12px 30px; border-radius: 8px; border: 2px dashed #86efac; display: inline-block;">
          ${otp}
        </span>
      </div>
      <p style="color: #718096; font-size: 14px; line-height: 20px;">If you did not request a password reset, please ignore this email. Your password will remain unchanged.</p>
      <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 30px 0;" />
      <p style="color: #718096; font-size: 14px; line-height: 20px; text-align: center; margin: 0;">
        Thank you,<br/>
        <strong>BIT Software & IT Solution Team</strong>
      </p>
    </div>
  `;

  try {
    await sendEmail(user.email, emailHtml);
  } catch (error) {
    console.error('Failed to send password reset OTP email:', error);
    // Clear the OTP we just saved since the email never reached the user.
    await User.findByIdAndUpdate(user._id, { otp: null, otpExpires: null });
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to send OTP email. Please try again later or contact support.',
    );
  }

  // Log in console for development/backup
  if (config.NODE_ENV === 'development') {
    console.log(`[DEV ONLY] OTP for ${email} is: ${otp}`);
  }
};

// ==================== RESET PASSWORD ====================
const resetPassword = async (
  payload: { email: string; otp: string; newPassword: string }
): Promise<void> => {
  // Check if user exists
  const user = await User.findOne({ email: payload.email }).select('+password');

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

  // Verify OTP exists and matches
  if (!user.otp || user.otp !== payload.otp) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid OTP');
  }

  // Verify OTP is not expired
  if (user.otpExpires && new Date() > user.otpExpires) {
    throw new AppError(httpStatus.BAD_REQUEST, 'OTP has expired');
  }

  // Update password (model middleware will hash it)
  user.password = payload.newPassword;
  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save();
};

// ==================== GOOGLE VERIFICATION ====================
const googleVerify = async (idToken: string): Promise<IAuthResponse> => {
  let payload: { email?: string; name?: string; picture?: string } | undefined;
  try {
    if (idToken.split('.').length === 3) {
      // It's a JWT (ID Token)
      const ticket = await client.verifyIdToken({
        idToken,
        audience: config.google_client_id,
      });
      const googlePayload = ticket.getPayload();
      if (googlePayload) {
        payload = {
          email: googlePayload.email,
          name: googlePayload.name,
          picture: googlePayload.picture,
        };
      }
    } else {
      // It's an Access Token, fetch info from userinfo endpoint
      const response = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${idToken}`);
      if (response.ok) {
        const data = await response.json() as { email?: string; name?: string; picture?: string };
        payload = {
          email: data.email,
          name: data.name,
          picture: data.picture,
        };
      }
    }
  } catch (error) {
    console.error('Google verification error details:', error);
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid Google Token');
  }

  if (!payload || !payload.email) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Failed to retrieve user information from Google');
  }

  const { email, name, picture } = payload;

  // Find if user already exists
  let user = await User.findOne({ email });

  if (!user) {
    // Register the new user
    const randomPassword = crypto.randomBytes(16).toString('hex');
    user = await User.create({
      name: name || 'Google User',
      email,
      password: randomPassword,
      profileImage: picture || '',
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
    });
  } else {
    // Check if user is deleted
    if (User.isUserDeleted(user)) {
      throw new AppError(httpStatus.FORBIDDEN, 'This user has been deleted');
    }

    // Check if user is blocked
    if (User.isUserBlocked(user)) {
      throw new AppError(httpStatus.FORBIDDEN, 'This user is blocked');
    }

    // Update profile image if available from Google
    if (picture && user.profileImage !== picture) {
      user.profileImage = picture;
      await user.save();
    }
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
      profileImage: user.profileImage,
    },
  };
};

export const AuthServices = {
  registerUser,
  loginUser,
  changePassword,
  refreshToken,
  forgetPassword,
  resetPassword,
  googleVerify,
};
