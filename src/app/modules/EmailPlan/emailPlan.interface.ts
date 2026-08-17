// ============================================
// BIT SOFTWARE — Business Email Plan Interface
// ============================================
// Public catalog of Business Email packages.
// White-label: customer never sees upstream provider details.

import { Types } from 'mongoose';

export interface IEmailPlan {
  slug: string;
  name: string;
  monthlyPriceUSD: number;
  yearlyPriceUSD: number;
  features: string[];
  popular: boolean;
  isActive: boolean;
  sortOrder: number;
  notes?: string;
  updatedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Seed defaults — used only when DB has no email plans yet. */
export const DEFAULT_EMAIL_PLANS: Array<{
  slug: string;
  name: string;
  monthlyPriceUSD: number;
  yearlyPriceUSD: number;
  features: string[];
  popular: boolean;
  sortOrder: number;
}> = [
  {
    slug: 'email-starter',
    name: 'Starter',
    monthlyPriceUSD: 7,
    yearlyPriceUSD: 70,
    features: [
      'Secure custom business email (you@your-company.com)',
      '30 GB cloud storage per user',
      'Video meetings up to 100 participants',
      'Team chat & shared calendar',
      'Online documents & forms',
      'Basic security & admin controls',
    ],
    popular: false,
    sortOrder: 1,
  },
  {
    slug: 'email-standard',
    name: 'Standard',
    monthlyPriceUSD: 14,
    yearlyPriceUSD: 140,
    features: [
      'Everything in Starter',
      '2 TB cloud storage per user',
      'Video meetings up to 150 participants with recording',
      'Custom email layouts & mail merge',
      'Appointment booking pages',
      'eSignature for documents',
      'Expanded AI assistant access',
    ],
    popular: true,
    sortOrder: 2,
  },
  {
    slug: 'email-plus',
    name: 'Plus',
    monthlyPriceUSD: 22,
    yearlyPriceUSD: 221,
    features: [
      'Everything in Standard',
      '5 TB cloud storage per user',
      'Video meetings up to 500 participants',
      'Attendance tracking',
      'Data archive & search (Vault)',
      'Advanced endpoint management',
      'Enhanced security controls',
    ],
    popular: false,
    sortOrder: 3,
  },
];
