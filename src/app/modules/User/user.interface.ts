import { Document, Model } from 'mongoose';

// User Role Enum
export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

export type TUserRole = `${UserRole}`;

// User Status Enum
export enum UserStatus {
  ACTIVE = 'active',
  BLOCKED = 'blocked',
}

// Main User Interface
export interface IUser {
  name: string;
  email: string;
  password: string;
  // Public-facing 6-digit customer identity (random, e.g. "125425").
  userCode?: string;
  role: UserRole;
  status: UserStatus;
  phone?: string;
  address?: string;
  profileImage?: string;
  // Namecheap-style extended profile fields
  firstName?: string;
  lastName?: string;
  organization?: string;
  jobTitle?: string;
  alternatePhone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  country?: string;
  accountBalance?: number;
  isDeleted: boolean;
  passwordChangedAt?: Date;
  otp?: string;
  otpExpires?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

// User Document Interface (for Mongoose)
export interface IUserDocument extends IUser, Document {
  comparePassword(candidatePassword: string): Promise<boolean>;
}

// User Model Interface (for static methods)
export interface IUserModel extends Model<IUserDocument> {
  isUserExistsByEmail(email: string): Promise<IUserDocument | null>;
  isPasswordMatched(
    plainTextPassword: string,
    hashedPassword: string,
  ): Promise<boolean>;
  isUserDeleted(user: IUserDocument): boolean;
  isUserBlocked(user: IUserDocument): boolean;
  isJWTIssuedBeforePasswordChanged(
    passwordChangedTimestamp: Date,
    jwtIssuedTimestamp: number,
  ): boolean;
}

// Response Interface (without sensitive data)
export interface IUserResponse {
  _id: string;
  name: string;
  email: string;
  userCode?: string;
  role: UserRole;
  status: UserStatus;
  phone?: string;
  address?: string;
  profileImage?: string;
  firstName?: string;
  lastName?: string;
  organization?: string;
  jobTitle?: string;
  alternatePhone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  country?: string;
  accountBalance?: number;
  createdAt?: Date;
  updatedAt?: Date;
}
