// ============================================
// BIT SOFTWARE — Hosting Order Service
// ============================================
// Authenticated PayPal purchase flow (mirrors DomainOrder):
//   1. createPayPalOrderForHosting → pending DB order + PayPal order
//   2. completeHostingPurchase → capture payment + create Hosting asset
//
// Behind-the-scenes provider provisioning is admin-managed later.
// Customer immediately sees their purchased plan as active.

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { HostingOrder } from './hostingOrder.model';
import { Hosting } from '../Hosting/hosting.model';
import {
  IHostingOrder,
  THostingBillingCycle,
  TSupportedCurrency,
} from './hostingOrder.interface';
import { getActivePlanBySlug } from '../HostingPlan/hostingPlan.service';
import {
  convertFromUSD,
  getExchangeRates,
} from '../DomainOrder/domainOrder.service';
import {
  createPayPalOrder,
  capturePayPalOrder,
  refundPayPalCapture,
} from '../../utils/paypal';
import { sendEmail } from '../../utils/sendEmail';
import config from '../../config';

const generateOrderId = async (): Promise<string> => {
  let id = '';
  let unique = false;
  while (!unique) {
    id = `HST-${Math.floor(100000 + Math.random() * 900000)}`;
    const existing = await HostingOrder.findOne({ orderId: id });
    if (!existing) unique = true;
  }
  return id;
};

const addBillingPeriod = (base: Date, cycle: THostingBillingCycle): Date => {
  const d = new Date(base);
  if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
};

const getAdminEmail = (): string =>
  process.env.ADMIN_EMAIL?.trim() || config.smtp_user || 'admin@bitsoftwareitsolution.com';

/**
 * STEP 1: Create pending hosting order + PayPal order.
 */
export const createPayPalOrderForHosting = async (payload: {
  planSlug: string;
  billingCycle: THostingBillingCycle;
  displayCurrency: TSupportedCurrency;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  websiteLabel?: string;
  userId: string;
}): Promise<{
  orderId: string;
  dbOrderId: string;
  paypalOrderId: string;
  displayAmount: number;
  displayCurrency: string;
  sellPriceUSD: number;
}> => {
  const {
    planSlug,
    billingCycle,
    displayCurrency,
    customerName,
    customerEmail,
    customerPhone,
    websiteLabel,
    userId,
  } = payload;

  if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
    throw new AppError(httpStatus.BAD_REQUEST, 'billingCycle must be monthly or yearly.');
  }

  const plan = await getActivePlanBySlug(planSlug);
  const sellPriceUSD =
    billingCycle === 'monthly' ? plan.monthlyPriceUSD : plan.yearlyPriceUSD;

  if (typeof sellPriceUSD !== 'number' || sellPriceUSD <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid plan pricing.');
  }

  const { displayAmount, rate } = await convertFromUSD(sellPriceUSD, displayCurrency);

  const cycleLabel = billingCycle === 'monthly' ? '1 month' : '1 year';
  const paypalRes = await createPayPalOrder(
    sellPriceUSD.toFixed(2),
    `Hosting: ${plan.planType} ${plan.name} (${cycleLabel})`,
    'hosting',
  );

  const paypalOrderId = paypalRes.id;
  if (!paypalOrderId) throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to create PayPal order.');

  const orderId = await generateOrderId();

  const hostingOrder = await HostingOrder.create({
    orderId,
    userId: new mongoose.Types.ObjectId(userId),
    planSlug: plan.slug,
    planName: plan.name,
    planType: plan.planType,
    billingCycle,
    features: plan.features || [],
    websiteLabel: websiteLabel?.trim(),
    sellPriceUSD,
    displayCurrency,
    displayAmount,
    exchangeRateUsed: rate,
    paymentMethod: 'paypal',
    paymentStatus: 'pending',
    paypalOrderId,
    orderStatus: 'pending_payment',
    hostingPlanId: (plan as any)._id,
    customerName,
    customerEmail,
    customerPhone,
  });

  return {
    orderId,
    dbOrderId: hostingOrder._id.toString(),
    paypalOrderId,
    displayAmount,
    displayCurrency,
    sellPriceUSD,
  };
};

/**
 * STEP 2: Capture PayPal + activate hosting asset for the customer.
 */
export const completeHostingPurchase = async (payload: {
  paypalOrderId: string;
  userId: string;
}): Promise<IHostingOrder> => {
  const { paypalOrderId, userId } = payload;

  const pendingOrder = await HostingOrder.findOne({
    paypalOrderId,
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: 'pending_payment',
    paymentStatus: 'pending',
  });

  if (!pendingOrder) {
    const completed = await HostingOrder.findOne({
      paypalOrderId,
      userId: new mongoose.Types.ObjectId(userId),
    });
    if (completed && completed.orderStatus === 'active') {
      return completed.toObject() as IHostingOrder;
    }
    throw new AppError(
      httpStatus.NOT_FOUND,
      'Pending hosting order not found. Payment may have already been processed.',
    );
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
      Math.abs(capturedAmountUSD - pendingOrder.sellPriceUSD) > 0.01
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
        `Payment amount mismatch. Expected $${pendingOrder.sellPriceUSD} USD, got $${capturedAmountUSD} ${capturedCurrency}.`,
      );
    }

    const now = new Date();
    const expiresAt = addBillingPeriod(now, pendingOrder.billingCycle);

    await HostingOrder.updateOne(
      { _id: pendingOrder._id },
      {
        $set: {
          paymentStatus: 'paid',
          orderStatus: 'processing',
          paypalCaptureId: captureId,
          paypalTransactionId: captureUnit?.id,
          startsAt: now,
          expiresAt,
        },
      },
      { session },
    );

    // Create customer-facing hosting asset (white-label — their purchased plan)
    const [asset] = await Hosting.create(
      [
        {
          userId: pendingOrder.userId,
          planSlug: pendingOrder.planSlug,
          planName: pendingOrder.planName,
          planType: pendingOrder.planType,
          billingCycle: pendingOrder.billingCycle,
          features: pendingOrder.features || [],
          websiteLabel: pendingOrder.websiteLabel,
          source: 'purchase',
          status: 'active',
          startsAt: now,
          expiresAt,
          amountUSD: pendingOrder.sellPriceUSD,
          renewPriceUSD: pendingOrder.sellPriceUSD,
          hostingOrderId: pendingOrder._id,
          hostingPlanId: pendingOrder.hostingPlanId,
        },
      ],
      { session },
    );

    await HostingOrder.updateOne(
      { _id: pendingOrder._id },
      {
        $set: {
          orderStatus: 'active',
          hostingAssetId: asset._id,
        },
      },
      { session },
    );

    await session.commitTransaction();

    // Emails (non-critical)
    try {
      await sendEmail(
        pendingOrder.customerEmail,
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4F46E5;">Hosting Activated Successfully!</h2>
            <p>Dear ${pendingOrder.customerName},</p>
            <p>Your <strong>${pendingOrder.planType} ${pendingOrder.planName}</strong> hosting plan is now active.</p>
            <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Plan</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.planName} (${pendingOrder.planType})</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Billing</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.billingCycle}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Starts</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${now.toDateString()}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Expires</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${expiresAt.toDateString()}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Amount Paid</td><td style="padding: 8px; border: 1px solid #e5e7eb;">$${pendingOrder.sellPriceUSD} USD</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Order ID</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.orderId}</td></tr>
            </table>
            <p>Manage your hosting from <a href="${process.env.FRONTEND_URL}/my-account?tab=hosting">My Account → Hosting</a>.</p>
            <p>Thank you for choosing BIT Software & IT Solution!</p>
          </div>
        `,
        `✅ Hosting "${pendingOrder.planName}" Activated — BIT Software`,
      );
    } catch (emailErr) {
      console.error('[HostingPurchase] Customer email failed:', emailErr);
    }

    try {
      await sendEmail(
        getAdminEmail(),
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>New Hosting Purchase</h2>
            <p>Order <strong>${pendingOrder.orderId}</strong> — ${pendingOrder.customerName} (${pendingOrder.customerEmail})</p>
            <p>Plan: ${pendingOrder.planType} / ${pendingOrder.planName} (${pendingOrder.billingCycle}) — $${pendingOrder.sellPriceUSD} USD</p>
            <p>Provision behind-the-scenes as needed. Customer already sees their plan as active.</p>
          </div>
        `,
        `🛒 New Hosting Order ${pendingOrder.orderId}`,
      );
    } catch (adminEmailErr) {
      console.error('[HostingPurchase] Admin email failed:', adminEmailErr);
    }

    const refreshed = await HostingOrder.findById(pendingOrder._id);
    return (refreshed?.toObject() || pendingOrder.toObject()) as IHostingOrder;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

export const getUserHostingOrders = async (userId: string) => {
  return HostingOrder.find({
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: { $ne: 'pending_payment' },
  })
    .sort({ createdAt: -1 })
    .lean();
};

export const getHostingOrderById = async (id: string, userId?: string) => {
  const filter: Record<string, unknown> = {
    $or: [{ _id: id }, { orderId: id }],
  };
  if (userId) filter.userId = new mongoose.Types.ObjectId(userId);

  const order = await HostingOrder.findOne(filter).lean();
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Hosting order not found.');
  return order;
};

export const getAllHostingOrders = async (query: Record<string, unknown>) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.orderStatus) filter.orderStatus = query.orderStatus;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.planType) filter.planType = query.planType;
  if (query.search) {
    const term = String(query.search).trim();
    filter.$or = [
      { orderId: { $regex: term, $options: 'i' } },
      { customerName: { $regex: term, $options: 'i' } },
      { customerEmail: { $regex: term, $options: 'i' } },
      { planName: { $regex: term, $options: 'i' } },
    ];
  }

  const [orders, total] = await Promise.all([
    HostingOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name email')
      .lean(),
    HostingOrder.countDocuments(filter),
  ]);

  return {
    orders,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const updateHostingOrderStatus = async (
  id: string,
  payload: { orderStatus?: string; paymentStatus?: string; failureReason?: string },
) => {
  const order = await HostingOrder.findById(id);
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Hosting order not found.');

  if (payload.orderStatus) order.orderStatus = payload.orderStatus as any;
  if (payload.paymentStatus) order.paymentStatus = payload.paymentStatus as any;
  if (payload.failureReason !== undefined) order.failureReason = payload.failureReason;

  await order.save();
  return order.toObject() as IHostingOrder;
};

export const getPublicExchangeRates = async () => getExchangeRates();

/** Cancel unpaid checkouts older than 3 hours (same idea as domain). */
export const sweepAbandonedHostingCheckouts = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const result = await HostingOrder.updateMany(
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
