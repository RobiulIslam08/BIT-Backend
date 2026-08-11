// ============================================
// BIT SOFTWARE — Digital Service Order Service
// ============================================

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { DigitalServiceOrder } from './digitalServiceOrder.model';
import { DigitalService } from '../DigitalService/digitalService.model';
import { IDigitalServiceOrder } from './digitalServiceOrder.interface';
import {
  SAR_TO_USD_RATE,
  getPackageDef,
  TDigitalPackageType,
  TDigitalServiceKey,
} from '../DigitalService/digitalService.catalog';
import {
  createPayPalOrder,
  capturePayPalOrder,
  refundPayPalCapture,
} from '../../utils/paypal';
import { roundMoney } from '../../utils/money';
import { sendEmail } from '../../utils/sendEmail';
import config from '../../config';
import { WalletService } from '../Wallet/wallet.service';

const generateOrderId = async (): Promise<string> => {
  let id = '';
  let unique = false;
  while (!unique) {
    id = `DSV-${Math.floor(100000 + Math.random() * 900000)}`;
    const existing = await DigitalServiceOrder.findOne({ orderId: id });
    if (!existing) unique = true;
  }
  return id;
};

const addDays = (base: Date, days: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};

const getAdminEmail = (): string =>
  process.env.ADMIN_EMAIL?.trim() || config.smtp_user || 'admin@bitsoftwareitsolution.com';

const resolvePeriod = async (
  userId: string,
  serviceKey: TDigitalServiceKey,
  packageType: TDigitalPackageType,
  durationDays: number,
): Promise<{ startsAt: Date; expiresAt: Date }> => {
  const now = new Date();

  if (packageType === 'trial') {
    return { startsAt: now, expiresAt: addDays(now, durationDays) };
  }

  // Extend from max(now, current active expiry) for renewals
  const active = await DigitalService.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    serviceKey,
    status: { $in: ['active', 'pending'] },
    expiresAt: { $gt: now },
  })
    .sort({ expiresAt: -1 })
    .lean();

  const base =
    active?.expiresAt && new Date(active.expiresAt) > now
      ? new Date(active.expiresAt)
      : now;

  return { startsAt: now, expiresAt: addDays(base, durationDays) };
};

/** True if user already used a trial for this service (paid order or asset). */
export const hasUsedTrial = async (
  userId: string,
  serviceKey: TDigitalServiceKey,
): Promise<boolean> => {
  const uid = new mongoose.Types.ObjectId(userId);

  const [order, asset] = await Promise.all([
    DigitalServiceOrder.findOne({
      userId: uid,
      serviceKey,
      packageType: 'trial',
      paymentStatus: 'paid',
      orderStatus: { $in: ['processing', 'active'] },
    }).lean(),
    DigitalService.findOne({
      userId: uid,
      serviceKey,
      packageType: 'trial',
    }).lean(),
  ]);

  return Boolean(order || asset);
};

const assertTrialAllowed = async (
  userId: string,
  serviceKey: TDigitalServiceKey,
  packageType: TDigitalPackageType,
) => {
  if (packageType !== 'trial') return;
  if (await hasUsedTrial(userId, serviceKey)) {
    throw new AppError(
      httpStatus.CONFLICT,
      'You have already used the trial for this service. Please choose Monthly or Yearly.',
    );
  }
};

/**
 * STEP 1: Create pending order + PayPal order.
 */
export const createPayPalOrderForDigitalService = async (payload: {
  serviceKey: string;
  packageType: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  userId: string;
}): Promise<{
  orderId: string;
  dbOrderId: string;
  paypalOrderId: string;
  amountSAR: number;
  amountUSD: number;
  packageType: TDigitalPackageType;
  serviceKey: TDigitalServiceKey;
  serviceName: string;
}> => {
  const { customerName, customerEmail, customerPhone, userId } = payload;

  let resolved;
  try {
    resolved = getPackageDef(payload.serviceKey, payload.packageType);
  } catch (e: any) {
    throw new AppError(httpStatus.BAD_REQUEST, e.message || 'Invalid service package.');
  }

  const { service, pkg, packageType } = resolved;
  await assertTrialAllowed(userId, service.key, packageType);

  const amountSAR = pkg.priceSAR;
  const amountUSD = roundMoney(amountSAR / SAR_TO_USD_RATE);

  const paypalRes = await createPayPalOrder(
    amountUSD.toFixed(2),
    `${service.name} — ${pkg.label}`,
    'digital_service',
  );

  const paypalOrderId = paypalRes.id;
  if (!paypalOrderId) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to create PayPal order.');
  }

  const orderId = await generateOrderId();

  const doc = await DigitalServiceOrder.create({
    orderId,
    userId: new mongoose.Types.ObjectId(userId),
    serviceKey: service.key,
    serviceName: service.name,
    packageType,
    packageLabel: pkg.label,
    durationDays: pkg.durationDays,
    amountSAR,
    amountUSD,
    exchangeRateUsed: SAR_TO_USD_RATE,
    paymentMethod: 'paypal',
    paymentStatus: 'pending',
    paypalOrderId,
    orderStatus: 'pending_payment',
    customerName,
    customerEmail,
    customerPhone,
  });

  return {
    orderId,
    dbOrderId: doc._id.toString(),
    paypalOrderId,
    amountSAR,
    amountUSD,
    packageType,
    serviceKey: service.key,
    serviceName: service.name,
  };
};

/**
 * STEP 2: Capture PayPal + create DigitalService asset.
 */
export const completeDigitalServicePurchase = async (payload: {
  paypalOrderId: string;
  userId: string;
}): Promise<IDigitalServiceOrder> => {
  const { paypalOrderId, userId } = payload;

  const pendingOrder = await DigitalServiceOrder.findOne({
    paypalOrderId,
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: 'pending_payment',
    paymentStatus: 'pending',
  });

  if (!pendingOrder) {
    const completed = await DigitalServiceOrder.findOne({
      paypalOrderId,
      userId: new mongoose.Types.ObjectId(userId),
    });
    if (completed && completed.orderStatus === 'active') {
      return completed.toObject() as IDigitalServiceOrder;
    }
    throw new AppError(
      httpStatus.NOT_FOUND,
      'Pending order not found. Payment may have already been processed.',
    );
  }

  // Re-check trial right before fulfillment
  if (pendingOrder.packageType === 'trial') {
    await assertTrialAllowed(userId, pendingOrder.serviceKey, 'trial');
  }

  const session = await mongoose.startSession();
  let captureId: string | null = null;

  try {
    session.startTransaction();

    let captureResult: any;
    try {
      captureResult = await capturePayPalOrder(paypalOrderId);
    } catch (err: any) {
      await session.abortTransaction();
      throw new AppError(httpStatus.PAYMENT_REQUIRED, `PayPal capture failed: ${err.message}`);
    }

    const captureStatus = captureResult?.status;
    if (captureStatus !== 'COMPLETED') {
      await session.abortTransaction();
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        `PayPal payment not completed. Status: ${captureStatus}`,
      );
    }

    const captureUnit = captureResult?.purchase_units?.[0]?.payments?.captures?.[0];
    captureId = captureUnit?.id ?? null;
    const capturedAmountUSD = parseFloat(captureUnit?.amount?.value ?? '0');
    const capturedCurrency = captureUnit?.amount?.currency_code ?? 'USD';

    if (
      capturedCurrency !== 'USD' ||
      Math.abs(capturedAmountUSD - pendingOrder.amountUSD) > 0.01
    ) {
      if (captureId) {
        try {
          await refundPayPalCapture(captureId, capturedAmountUSD.toFixed(2), 'USD');
        } catch {
          /* log only */
        }
      }
      await session.abortTransaction();
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        `Payment amount mismatch. Expected $${pendingOrder.amountUSD} USD, got $${capturedAmountUSD} ${capturedCurrency}.`,
      );
    }

    const { startsAt, expiresAt } = await resolvePeriod(
      userId,
      pendingOrder.serviceKey,
      pendingOrder.packageType,
      pendingOrder.durationDays,
    );

    await DigitalServiceOrder.updateOne(
      { _id: pendingOrder._id },
      {
        $set: {
          paymentStatus: 'paid',
          orderStatus: 'processing',
          paypalCaptureId: captureId,
          paypalTransactionId: captureUnit?.id,
          startsAt,
          expiresAt,
        },
      },
      { session },
    );

    const [asset] = await DigitalService.create(
      [
        {
          userId: pendingOrder.userId,
          serviceKey: pendingOrder.serviceKey,
          serviceName: pendingOrder.serviceName,
          packageType: pendingOrder.packageType,
          packageLabel: pendingOrder.packageLabel,
          source: 'purchase',
          status: 'active',
          startsAt,
          expiresAt,
          amountSAR: pendingOrder.amountSAR,
          amountUSD: pendingOrder.amountUSD,
          orderId: pendingOrder._id,
        },
      ],
      { session },
    );

    await DigitalServiceOrder.updateOne(
      { _id: pendingOrder._id },
      {
        $set: {
          orderStatus: 'active',
          digitalServiceId: asset._id,
        },
      },
      { session },
    );

    await session.commitTransaction();

    try {
      await sendEmail(
        pendingOrder.customerEmail,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0066CC;">Service Activated Successfully!</h2>
            <p>Dear ${pendingOrder.customerName},</p>
            <p>Your <strong>${pendingOrder.serviceName}</strong> (${pendingOrder.packageLabel}) is now active.</p>
            <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Service</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.serviceName}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Package</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.packageLabel}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Starts</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${startsAt.toDateString()}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Expires</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${expiresAt.toDateString()}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Amount Paid</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.amountSAR} SAR</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Order ID</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.orderId}</td></tr>
            </table>
            <p>Manage your services from <a href="${process.env.FRONTEND_URL}/my-account?tab=services">My Account → Services</a>.</p>
            <p>Thank you for choosing BIT Software & IT Solution!</p>
          </div>
        `,
        `✅ ${pendingOrder.serviceName} Activated — BIT Software`,
      );
    } catch (emailErr) {
      console.error('[DigitalServicePurchase] Customer email failed:', emailErr);
    }

    try {
      await sendEmail(
        getAdminEmail(),
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>New Digital Service Purchase</h2>
            <p>Order <strong>${pendingOrder.orderId}</strong> — ${pendingOrder.customerName} (${pendingOrder.customerEmail})</p>
            <p>${pendingOrder.serviceName} / ${pendingOrder.packageLabel} — ${pendingOrder.amountSAR} SAR ($${pendingOrder.amountUSD} USD)</p>
            <p>Provision portal access from Admin → Services as needed.</p>
          </div>
        `,
        `🛒 New Service Order ${pendingOrder.orderId}`,
      );
    } catch (adminEmailErr) {
      console.error('[DigitalServicePurchase] Admin email failed:', adminEmailErr);
    }

    const refreshed = await DigitalServiceOrder.findById(pendingOrder._id);
    return (refreshed?.toObject() || pendingOrder.toObject()) as IDigitalServiceOrder;
  } catch (err: any) {
    if (session.inTransaction()) await session.abortTransaction();
    // Duplicate trial unique index race
    if (err?.code === 11000 && pendingOrder.packageType === 'trial') {
      if (captureId) {
        try {
          await refundPayPalCapture(captureId, pendingOrder.amountUSD.toFixed(2), 'USD');
        } catch {
          /* log */
        }
      }
      throw new AppError(
        httpStatus.CONFLICT,
        'You have already used the trial for this service. Please choose Monthly or Yearly.',
      );
    }
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * Pay with wallet — atomic debit + asset creation.
 */
export const payForDigitalServiceWithWallet = async (payload: {
  serviceKey: string;
  packageType: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  userId: string;
}): Promise<IDigitalServiceOrder> => {
  const { customerName, customerEmail, customerPhone, userId } = payload;

  let resolved;
  try {
    resolved = getPackageDef(payload.serviceKey, payload.packageType);
  } catch (e: any) {
    throw new AppError(httpStatus.BAD_REQUEST, e.message || 'Invalid service package.');
  }

  const { service, pkg, packageType } = resolved;
  await assertTrialAllowed(userId, service.key, packageType);

  const amountSAR = pkg.priceSAR;
  const amountUSD = roundMoney(amountSAR / SAR_TO_USD_RATE);

  // Double-submit guard
  const recentWalletOrder = await DigitalServiceOrder.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    serviceKey: service.key,
    packageType,
    paymentMethod: 'wallet',
    paymentStatus: 'paid',
    orderStatus: { $in: ['processing', 'active'] },
    createdAt: { $gte: new Date(Date.now() - 45_000) },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (recentWalletOrder) {
    return recentWalletOrder as IDigitalServiceOrder;
  }

  const orderId = await generateOrderId();
  const { startsAt, expiresAt } = await resolvePeriod(
    userId,
    service.key,
    packageType,
    pkg.durationDays,
  );

  const session = await mongoose.startSession();
  let createdOrderId: mongoose.Types.ObjectId | null = null;

  try {
    await session.withTransaction(async () => {
      const spend = await WalletService.spendFromWallet({
        userId,
        amountUSD,
        reference: { kind: 'digital_service_order', id: orderId },
        note: `${service.name}: ${pkg.label}`,
        session,
      });

      const [order] = await DigitalServiceOrder.create(
        [
          {
            orderId,
            userId: new mongoose.Types.ObjectId(userId),
            serviceKey: service.key,
            serviceName: service.name,
            packageType,
            packageLabel: pkg.label,
            durationDays: pkg.durationDays,
            amountSAR,
            amountUSD,
            exchangeRateUsed: SAR_TO_USD_RATE,
            paymentMethod: 'wallet',
            paymentStatus: 'paid',
            orderStatus: 'processing',
            walletTransactionId: new mongoose.Types.ObjectId(spend.transactionId),
            walletPromoUsed: spend.promoUsed,
            walletAccountUsed: spend.accountUsed,
            startsAt,
            expiresAt,
            customerName,
            customerEmail,
            customerPhone,
          },
        ],
        { session },
      );

      const [asset] = await DigitalService.create(
        [
          {
            userId: new mongoose.Types.ObjectId(userId),
            serviceKey: service.key,
            serviceName: service.name,
            packageType,
            packageLabel: pkg.label,
            source: 'purchase',
            status: 'active',
            startsAt,
            expiresAt,
            amountSAR,
            amountUSD,
            orderId: order._id,
          },
        ],
        { session },
      );

      await DigitalServiceOrder.updateOne(
        { _id: order._id },
        { $set: { orderStatus: 'active', digitalServiceId: asset._id } },
        { session },
      );

      createdOrderId = order._id;
    });
  } catch (err: any) {
    if (err?.code === 11000 && packageType === 'trial') {
      throw new AppError(
        httpStatus.CONFLICT,
        'You have already used the trial for this service. Please choose Monthly or Yearly.',
      );
    }
    throw err;
  } finally {
    session.endSession();
  }

  if (!createdOrderId) {
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to process wallet payment.');
  }

  try {
    await sendEmail(
      customerEmail,
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0066CC;">Service Activated Successfully!</h2>
          <p>Dear ${customerName},</p>
          <p>Your <strong>${service.name}</strong> (${pkg.label}) is now active (paid from your wallet).</p>
          <p><strong>Order ID:</strong> ${orderId}</p>
          <p>Manage from <a href="${process.env.FRONTEND_URL}/my-account?tab=services">My Account → Services</a>.</p>
        </div>
      `,
      `✅ ${service.name} Activated — BIT Software`,
    );
  } catch (emailErr) {
    console.error('[DigitalServiceWallet] Customer email failed:', emailErr);
  }

  const refreshed = await DigitalServiceOrder.findById(createdOrderId).lean();
  return refreshed as IDigitalServiceOrder;
};

export const getUserDigitalServiceOrders = async (userId: string) => {
  return DigitalServiceOrder.find({
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: { $ne: 'pending_payment' },
  })
    .sort({ createdAt: -1 })
    .lean();
};

export const getDigitalServiceOrderById = async (id: string, userId?: string) => {
  const filter: Record<string, unknown> = {
    $or: [{ _id: id }, { orderId: id }],
  };
  if (userId) filter.userId = new mongoose.Types.ObjectId(userId);

  const order = await DigitalServiceOrder.findOne(filter).lean();
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');
  return order;
};

export const getAllDigitalServiceOrders = async (query: Record<string, unknown>) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.orderStatus) filter.orderStatus = query.orderStatus;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.serviceKey) filter.serviceKey = query.serviceKey;
  if (query.packageType) filter.packageType = query.packageType;
  if (query.search) {
    const term = String(query.search).trim();
    filter.$or = [
      { orderId: { $regex: term, $options: 'i' } },
      { customerName: { $regex: term, $options: 'i' } },
      { customerEmail: { $regex: term, $options: 'i' } },
      { serviceName: { $regex: term, $options: 'i' } },
    ];
  }

  const [orders, total] = await Promise.all([
    DigitalServiceOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email')
      .lean(),
    DigitalServiceOrder.countDocuments(filter),
  ]);

  return {
    orders,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const updateDigitalServiceOrderStatus = async (
  id: string,
  payload: { orderStatus?: string; paymentStatus?: string; failureReason?: string },
) => {
  const order = await DigitalServiceOrder.findById(id);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');

  if (payload.orderStatus) order.orderStatus = payload.orderStatus as any;
  if (payload.paymentStatus) order.paymentStatus = payload.paymentStatus as any;
  if (payload.failureReason !== undefined) order.failureReason = payload.failureReason;

  await order.save();
  return order.toObject() as IDigitalServiceOrder;
};

export const sweepAbandonedDigitalServiceCheckouts = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const result = await DigitalServiceOrder.updateMany(
    {
      orderStatus: 'pending_payment',
      paymentStatus: 'pending',
      createdAt: { $lt: cutoff },
      abandonedAt: { $exists: false },
    },
    {
      $set: {
        orderStatus: 'cancelled',
        abandonedAt: new Date(),
        failureReason: 'Abandoned checkout (auto-cancelled)',
      },
    },
  );
  return result.modifiedCount || 0;
};
