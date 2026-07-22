// ============================================
// BIT SOFTWARE — Hosting Plan Interface
// ============================================
// Public catalog of hosting packages sold on the website.
// Customer sees these plans; behind-the-scenes provider
// allocation is managed separately by admin (never exposed).

import { Types } from 'mongoose';

export type THostingPlanType = 'shared' | 'vps';

export interface IHostingPlan {
  slug: string; // e.g. "shared-starter", "vps-business"
  name: string; // e.g. "Starter", "Business"
  planType: THostingPlanType;
  monthlyPriceUSD: number;
  yearlyPriceUSD: number;
  features: string[];
  popular: boolean;
  isActive: boolean;
  sortOrder: number;
  notes?: string; // admin-only
  updatedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Seed defaults — used only when DB has no hosting plans yet. */
export const DEFAULT_HOSTING_PLANS: Array<{
  slug: string;
  name: string;
  planType: THostingPlanType;
  monthlyPriceUSD: number;
  yearlyPriceUSD: number;
  features: string[];
  popular: boolean;
  sortOrder: number;
}> = [
  {
    slug: 'shared-starter',
    name: 'Starter',
    planType: 'shared',
    monthlyPriceUSD: 3.99,
    yearlyPriceUSD: 39,
    features: ['10 GB SSD', '1 Website', 'Unmetered Bandwidth', '10 Email Accounts', 'Free SSL', 'cPanel Access'],
    popular: false,
    sortOrder: 1,
  },
  {
    slug: 'shared-business',
    name: 'Business',
    planType: 'shared',
    monthlyPriceUSD: 7.99,
    yearlyPriceUSD: 79,
    features: ['50 GB SSD', '5 Websites', 'Unmetered Bandwidth', '50 Email Accounts', 'Free SSL', 'cPanel Access', 'Free Domain'],
    popular: true,
    sortOrder: 2,
  },
  {
    slug: 'shared-professional',
    name: 'Professional',
    planType: 'shared',
    monthlyPriceUSD: 14.99,
    yearlyPriceUSD: 149,
    features: ['Unlimited SSD', 'Unlimited Websites', 'Unmetered Bandwidth', 'Unlimited Email', 'Free SSL', 'cPanel Access', 'Free Domain', 'Priority Support'],
    popular: false,
    sortOrder: 3,
  },
  {
    slug: 'vps-starter',
    name: 'Starter',
    planType: 'vps',
    monthlyPriceUSD: 12.99,
    yearlyPriceUSD: 129,
    features: ['1 vCPU Core', '2 GB RAM', '40 GB NVMe', '2 TB Bandwidth', 'Root Access'],
    popular: false,
    sortOrder: 10,
  },
  {
    slug: 'vps-business',
    name: 'Business',
    planType: 'vps',
    monthlyPriceUSD: 24.99,
    yearlyPriceUSD: 249,
    features: ['2 vCPU Cores', '4 GB RAM', '80 GB NVMe', '4 TB Bandwidth', 'Root Access'],
    popular: true,
    sortOrder: 11,
  },
  {
    slug: 'vps-professional',
    name: 'Professional',
    planType: 'vps',
    monthlyPriceUSD: 44.99,
    yearlyPriceUSD: 449,
    features: ['4 vCPU Cores', '8 GB RAM', '160 GB NVMe', '8 TB Bandwidth', 'Root Access'],
    popular: false,
    sortOrder: 12,
  },
];
