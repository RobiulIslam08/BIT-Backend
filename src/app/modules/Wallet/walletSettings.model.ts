// ============================================
// BIT SOFTWARE — Wallet Settings (Singleton) Model
// ============================================
// Admin-configurable wallet rules. A single document keyed by 'default'.

import { Schema, model } from 'mongoose';
import { IWalletSettings } from './wallet.interface';

export const WALLET_SETTINGS_KEY = 'default';
export const DEFAULT_TOPUP_FEE_PERCENT = 5;
export const DEFAULT_MIN_TOPUP_USD = 1;

const WalletSettingsSchema = new Schema<IWalletSettings>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: WALLET_SETTINGS_KEY,
    },
    // Percentage fee deducted from each top-up (customer bears it). e.g. 5 = 5%.
    topupFeePercent: {
      type: Number,
      required: true,
      default: DEFAULT_TOPUP_FEE_PERCENT,
      min: 0,
      max: 100,
    },
    // Minimum allowed top-up amount in USD.
    minTopupUSD: {
      type: Number,
      required: true,
      default: DEFAULT_MIN_TOPUP_USD,
      min: 0,
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const WalletSettings = model<IWalletSettings>(
  'WalletSettings',
  WalletSettingsSchema,
);
