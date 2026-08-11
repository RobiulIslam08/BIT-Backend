// ============================================
// BIT SOFTWARE — Digital Service Asset Interface
// ============================================

import { Types } from 'mongoose';
import { TDigitalPackageType, TDigitalServiceKey } from './digitalService.catalog';

export type TDigitalServiceSource = 'purchase' | 'admin_assigned';
export type TDigitalServiceStatus =
  | 'active'
  | 'pending'
  | 'expired'
  | 'suspended'
  | 'cancelled';

export interface IDigitalService {
  userId: Types.ObjectId;

  serviceKey: TDigitalServiceKey;
  serviceName: string;
  packageType: TDigitalPackageType;
  packageLabel: string;

  source: TDigitalServiceSource;
  status: TDigitalServiceStatus;

  startsAt?: Date;
  expiresAt?: Date;

  amountSAR?: number;
  amountUSD?: number;

  orderId?: Types.ObjectId;
  assignedBy?: Types.ObjectId;

  /** Customer-facing portal URL once provisioned by admin */
  portalUrl?: string;
  /** Customer-facing access notes (credentials hint, etc.) */
  accessNotes?: string;
  /** Admin-only internal notes — never sent to customer */
  notes?: string;

  createdAt?: Date;
  updatedAt?: Date;
}
