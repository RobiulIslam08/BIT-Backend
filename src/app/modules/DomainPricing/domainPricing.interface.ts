// ============================================
// BIT SOFTWARE — Domain Pricing Interface
// ============================================
// Admin-maintainable sell prices per TLD.
// Customer pays registerPriceUSD on new purchase.
// renewPriceUSD / transferPriceUSD are used for public price lists
// (managed-domain renewals still use live registrar renew pricing).

import { Types } from 'mongoose';

export interface IDomainPricing {
  tld: string;                 // e.g. "com" (no leading dot)
  registerPriceUSD: number;    // sell price for new registration
  renewPriceUSD: number;       // displayed renew price (marketing / fallback)
  transferPriceUSD: number;    // displayed transfer price
  isActive: boolean;
  notes?: string;
  updatedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Seed defaults — used only when DB has no pricing rows yet. */
export const DEFAULT_DOMAIN_PRICING: Array<{
  tld: string;
  registerPriceUSD: number;
  renewPriceUSD: number;
  transferPriceUSD: number;
}> = [
  { tld: 'com', registerPriceUSD: 15, renewPriceUSD: 17, transferPriceUSD: 15 },
  { tld: 'net', registerPriceUSD: 17, renewPriceUSD: 19, transferPriceUSD: 17 },
  { tld: 'org', registerPriceUSD: 14, renewPriceUSD: 16, transferPriceUSD: 14 },
  { tld: 'io', registerPriceUSD: 55, renewPriceUSD: 58, transferPriceUSD: 55 },
  { tld: 'co', registerPriceUSD: 32, renewPriceUSD: 35, transferPriceUSD: 32 },
  { tld: 'info', registerPriceUSD: 12, renewPriceUSD: 14, transferPriceUSD: 12 },
  { tld: 'biz', registerPriceUSD: 17, renewPriceUSD: 19, transferPriceUSD: 17 },
  { tld: 'online', registerPriceUSD: 8, renewPriceUSD: 20, transferPriceUSD: 8 },
  { tld: 'tech', registerPriceUSD: 35, renewPriceUSD: 38, transferPriceUSD: 35 },
  { tld: 'store', registerPriceUSD: 10, renewPriceUSD: 35, transferPriceUSD: 10 },
  { tld: 'shop', registerPriceUSD: 22, renewPriceUSD: 22, transferPriceUSD: 22 },
  { tld: 'app', registerPriceUSD: 20, renewPriceUSD: 20, transferPriceUSD: 20 },
  { tld: 'dev', registerPriceUSD: 14, renewPriceUSD: 14, transferPriceUSD: 14 },
  { tld: 'site', registerPriceUSD: 8, renewPriceUSD: 8, transferPriceUSD: 8 },
  { tld: 'website', registerPriceUSD: 8, renewPriceUSD: 8, transferPriceUSD: 8 },
  { tld: 'cloud', registerPriceUSD: 22, renewPriceUSD: 22, transferPriceUSD: 22 },
  { tld: 'digital', registerPriceUSD: 32, renewPriceUSD: 32, transferPriceUSD: 32 },
  { tld: 'agency', registerPriceUSD: 32, renewPriceUSD: 32, transferPriceUSD: 32 },
  { tld: 'solutions', registerPriceUSD: 22, renewPriceUSD: 22, transferPriceUSD: 22 },
  { tld: 'services', registerPriceUSD: 22, renewPriceUSD: 22, transferPriceUSD: 22 },
];

export const FALLBACK_REGISTER_PRICE_USD = 20;
