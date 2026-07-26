import { Schema, model } from 'mongoose';
import bcrypt from 'bcryptjs';
import {
  IUserDocument,
  IUserModel,
  UserRole,
  UserStatus,
} from './user.interface';

const userSchema = new Schema<IUserDocument, IUserModel>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/,
        'Please provide a valid email address',
      ],
    },
    // Public 4-digit customer identity (sequential, starting at 5001 → 5002…).
    userCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Don't include password in queries by default
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.USER,
    },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.ACTIVE,
    },
    phone: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    profileImage: {
      type: String,
    },
    // Namecheap-style extended profile fields
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    organization: {
      type: String,
      trim: true,
    },
    jobTitle: {
      type: String,
      trim: true,
    },
    alternatePhone: {
      type: String,
      trim: true,
    },
    address1: {
      type: String,
      trim: true,
    },
    address2: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    stateProvince: {
      type: String,
      trim: true,
    },
    postalCode: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
    },
    // Withdrawable balance (money the customer topped up, minus fee). Stored in USD.
    accountBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Non-withdrawable promotional/gift credit granted by admin (offers, bonuses).
    // Spendable on services but can never be withdrawn. Stored in USD.
    promotionalCredit: {
      type: Number,
      default: 0,
      min: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    passwordChangedAt: {
      type: Date,
    },
    otp: {
      type: String,
      default: null,
    },
    otpExpires: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (_doc, ret: Record<string, unknown>) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Pre-save middleware: Hash password before saving
userSchema.pre('save', async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (this.isModified('password')) {
    try {
      const saltRounds = 12;
      this.password = await bcrypt.hash(this.password, saltRounds);
      
      // Update passwordChangedAt if user is already saved previously (not a new user)
      if (!this.isNew) {
        this.passwordChangedAt = new Date();
      }
    } catch (error) {
      return next(error as Error);
    }
  }

  // Assign the next sequential 4-digit customer code (5001+) on first save.
  if (this.isNew && !this.userCode) {
    try {
      this.userCode = await generateUniqueUserCode();
    } catch (error) {
      return next(error as Error);
    }
  }

  next();
});

// Post-save middleware: Remove password from the response
userSchema.post('save', function (doc, next) {
  doc.password = '';
  next();
});

// Query middleware: Exclude deleted users from queries
userSchema.pre('find', function (next) {
  this.find({ isDeleted: { $ne: true } });
  next();
});

userSchema.pre('findOne', function (next) {
  this.find({ isDeleted: { $ne: true } });
  next();
});

userSchema.pre('aggregate', function (next) {
  this.pipeline().unshift({ $match: { isDeleted: { $ne: true } } });
  next();
});

// Instance Method: Compare password
userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch {
    throw new Error('Password comparison failed');
  }
};

// Static Method: Check if user exists by email
userSchema.statics.isUserExistsByEmail = async function (
  email: string,
): Promise<IUserDocument | null> {
  return await this.findOne({ email }).select('+password');
};

// Static Method: Check if password matches
userSchema.statics.isPasswordMatched = async function (
  plainTextPassword: string,
  hashedPassword: string,
): Promise<boolean> {
  return await bcrypt.compare(plainTextPassword, hashedPassword);
};

// Static Method: Check if user is deleted
userSchema.statics.isUserDeleted = function (user: IUserDocument): boolean {
  return user.isDeleted === true;
};

// Static Method: Check if user is blocked
userSchema.statics.isUserBlocked = function (user: IUserDocument): boolean {
  return user.status === UserStatus.BLOCKED;
};

// Static Method: Check if JWT was issued before password changed
userSchema.statics.isJWTIssuedBeforePasswordChanged = function (
  passwordChangedTimestamp: Date,
  jwtIssuedTimestamp: number,
): boolean {
  const passwordChangedTime =
    new Date(passwordChangedTimestamp).getTime() / 1000;
  return passwordChangedTime > jwtIssuedTimestamp;
};

// Create and export the User model
export const User = model<IUserDocument, IUserModel>('User', userSchema);

const USER_CODE_START = 5001;
const USER_CODE_MAX = 9999;

/**
 * Generate the next sequential 4-digit customer code starting from 5001.
 * Finds the highest existing code in 5001–9999 (including soft-deleted users)
 * and returns max+1.
 */
export const generateUniqueUserCode = async (): Promise<string> => {
  for (let attempt = 0; attempt < 50; attempt++) {
    // Use the raw collection so soft-deleted users' codes stay reserved.
    const usersWithCodes = await User.collection
      .find(
        { userCode: { $exists: true, $nin: [null, ''] } },
        { projection: { userCode: 1 } },
      )
      .toArray();

    let maxCode = USER_CODE_START - 1;
    for (const user of usersWithCodes) {
      const n = Number.parseInt(String(user.userCode), 10);
      if (
        Number.isInteger(n) &&
        n >= USER_CODE_START &&
        n <= USER_CODE_MAX &&
        String(n) === String(user.userCode).trim()
      ) {
        if (n > maxCode) maxCode = n;
      }
    }

    const next = maxCode + 1;
    if (next > USER_CODE_MAX) {
      throw new Error('User code range exhausted (5001–9999).');
    }

    const code = String(next);
    const exists = await User.collection.findOne({ userCode: code }, { projection: { _id: 1 } });
    if (!exists) return code;
  }
  throw new Error('Could not generate a unique user code after several attempts.');
};
