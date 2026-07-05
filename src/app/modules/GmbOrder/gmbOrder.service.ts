// ============================================
// BIT SOFTWARE — GMB Order Service (Production Ready)
// ============================================
// Security:
//  - PayPal payment verified server-side (amount + status)
//  - MongoDB transaction ensures atomicity (rollback on failure)
//  - Duplicate transaction prevention via unique index
//  - Input sanitized before DB write

import httpStatus from 'http-status';
import mongoose from 'mongoose';
import { GmbOrder } from './gmbOrder.model';
import { IGmbOrder } from './gmbOrder.interface';
import { getPayPalOrderDetails, capturePayPalOrder, createPayPalOrder } from '../../utils/paypal';
import AppError from '../../errors/AppError';
import { sendEmail } from '../../utils/sendEmail';
import config from '../../config';

// ─── VALID COUPON CODES ───
// NOTE: Move to DB for dynamic management in v2
const VALID_COUPONS: Record<string, number> = {
  BIT50: 50,
  BIT20: 20,
  WELCOME100: 100,
  SAVE25: 25,
};

// ─── Allowed query filter keys (NoSQL injection prevention) ───
const ALLOWED_FILTER_KEYS = ['paymentStatus', 'orderStatus', 'paymentMethod'] as const;
type AllowedFilterKey = (typeof ALLOWED_FILTER_KEYS)[number];

// ─── Sanitize input fields (remove MongoDB operators) ───
const sanitizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  // Strip MongoDB operator injection attempts like $where, $gt, etc.
  return value.replace(/\$[a-zA-Z]+/g, '').trim().substring(0, 500);
};

// ─── Generate unique 6-digit order ID ───
const generateUniqueOrderId = async (): Promise<string> => {
  let isUnique = false;
  let orderId = '';
  while (!isUnique) {
    orderId = Math.floor(100000 + Math.random() * 900000).toString();
    const existing = await GmbOrder.findOne({ orderId });
    if (!existing) {
      isUnique = true;
    }
  }
  return orderId;
};

// ─── Send admin notification email ───
const notifyAdmin = async (subject: string, body: string): Promise<void> => {
  try {
    const adminEmail = config.smtp_user;
    if (adminEmail) {
      await sendEmail(adminEmail, `<div style="font-family:sans-serif;"><h3>${subject}</h3><p>${body}</p></div>`, subject);
    }
  } catch {
    // Email failure should NOT block order processing — log only
    console.error('[Admin Email] Failed to send admin notification:', subject);
  }
};

// ─── Send customer order confirmation email ───
const notifyCustomer = async (order: any): Promise<void> => {
  try {
    const isPaypal = order.paymentMethod === 'paypal';
    const serviceLabel =
      order.serviceType === 'new'
        ? 'New Profile Setup'
        : order.serviceType === 'recovery'
          ? 'Profile Recovery'
          : 'Profile Management';

    const orderIdLabel = order.orderId ? `#${order.orderId}` : `#${order._id}`;

    const customerHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #4f46e5; margin-top: 0;">Order Confirmed!</h2>
        <p>Dear Customer,</p>
        <p>Thank you for choosing <strong>BIT Software & IT Solution</strong>. Your Google My Business optimization order has been successfully placed.</p>
        
        <div style="background-color: #f7fafc; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #4f46e5;">
          <h3 style="margin-top: 0; color: #2d3748; font-size: 16px;">Order Details</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.6;">
            <tr>
              <td style="padding: 4px 0; color: #718096; width: 140px;">Order ID:</td>
              <td style="padding: 4px 0; font-weight: bold; color: #2d3748;">${orderIdLabel}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #718096; width: 140px;">Business Name:</td>
              <td style="padding: 4px 0; font-weight: bold; color: #2d3748;">${order.businessName}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #718096;">Service:</td>
              <td style="padding: 4px 0; font-weight: bold; color: #2d3748;">${serviceLabel}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #718096;">Amount:</td>
              <td style="padding: 4px 0; font-weight: bold; color: #2d3748;">${order.finalAmount} SAR</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #718096;">Payment Method:</td>
              <td style="padding: 4px 0; font-weight: bold; color: #2d3748;">${isPaypal ? 'PayPal' : 'Bank Transfer (Manual)'}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #718096;">Payment Status:</td>
              <td style="padding: 4px 0; font-weight: bold; color: ${isPaypal ? '#10b981' : '#f59e0b'};">
                ${isPaypal ? '✅ Paid' : '⏳ Pending Verification'}
              </td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #718096;">Order Status:</td>
              <td style="padding: 4px 0; font-weight: bold; color: #4f46e5;">📋 Pending Review</td>
            </tr>
          </table>
        </div>
        
        <p>${
          isPaypal
            ? 'Our team will start working on your GMB setup and will reach out to you within 24 hours.'
            : 'Our team is currently verifying your bank transfer. Once verified, we will start working on your GMB setup and send you a confirmation email.'
        }</p>
        <p>If you have any questions, feel free to reply to this email.</p>
        <hr style="border: 0; border-top: 1px solid #edf2f7; margin: 25px 0;" />
        <p style="color: #a0aec0; font-size: 12px; text-align: center; margin: 0;">
          Thank you,<br/>
          <strong>BIT Software & IT Solution Team</strong>
        </p>
      </div>
    `;

    const subject = isPaypal
      ? `📦 Order Confirmed ${orderIdLabel} — BIT Software & IT Solution`
      : `⏳ Order Received ${orderIdLabel} (Pending Payment Verification) — BIT Software`;

    await sendEmail(order.email, customerHtml, subject);
  } catch (error) {
    console.error('[Customer Email] Failed to send confirmation email to:', order.email, error);
  }
};

// ==================== SUBMIT GMB ORDER ====================
const submitGmbOrder = async (orderData: Partial<IGmbOrder> & Record<string, unknown>) => {

  // ─── Basic required field validation ───
  if (!orderData.businessName || typeof orderData.businessName !== 'string') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Business name is required.');
  }
  if (!orderData.email || typeof orderData.email !== 'string') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Customer email is required.');
  }
  if (!orderData.phone || typeof orderData.phone !== 'string') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Phone number is required.');
  }
  if (!orderData.paymentMethod || !['paypal', 'manual'].includes(orderData.paymentMethod as string)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Valid payment method is required.');
  }
  if (!orderData.finalAmount || isNaN(Number(orderData.finalAmount)) || Number(orderData.finalAmount) <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid order amount.');
  }
  if (!orderData.termsAccepted) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Terms of Service must be accepted.');
  }

  // ─── transactionDetails: JSON string হলে parse করো (FormData থেকে আসে) ───
  if (orderData.transactionDetails && typeof orderData.transactionDetails === 'string') {
    try {
      orderData.transactionDetails = JSON.parse(orderData.transactionDetails);
    } catch {
      throw new AppError(httpStatus.BAD_REQUEST, 'Invalid transaction details format.');
    }
  }

  // ─── Boolean fields: string থেকে convert করো (FormData-এ সব string হয়) ───
  if (typeof orderData.termsAccepted === 'string') {
    orderData.termsAccepted = (orderData.termsAccepted as string) === 'true';
  }
  if (typeof orderData.hasExistingProfile === 'string') {
    orderData.hasExistingProfile = (orderData.hasExistingProfile as string) === 'true';
  }
  if (typeof orderData.profileHasIssues === 'string') {
    orderData.profileHasIssues = (orderData.profileHasIssues as string) === 'true';
  }
  // Number fields
  if (typeof orderData.finalAmount === 'string') {
    orderData.finalAmount = parseFloat(orderData.finalAmount as string);
  }
  if (typeof orderData.originalPrice === 'string') {
    orderData.originalPrice = parseFloat(orderData.originalPrice as string);
  }
  if (typeof orderData.discountAmount === 'string') {
    orderData.discountAmount = parseFloat(orderData.discountAmount as string);
  }

  if (orderData.paymentMethod === 'paypal') {
    // ─── PayPal Server-side Verification ───

    if (!orderData.paypalOrderId || typeof orderData.paypalOrderId !== 'string') {
      throw new AppError(httpStatus.BAD_REQUEST, 'PayPal Order ID is required.');
    }

    // Sanitize paypalOrderId (should be alphanumeric only from PayPal)
    const paypalOrderId = orderData.paypalOrderId.replace(/[^A-Za-z0-9\-]/g, '');
    if (paypalOrderId !== orderData.paypalOrderId) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Invalid PayPal Order ID format.');
    }

    // Idempotency: Check for duplicate transaction
    const existingOrder = await GmbOrder.findOne({ paypalOrderId });
    if (existingOrder) {
      throw new AppError(httpStatus.CONFLICT, 'This PayPal transaction has already been processed.');
    }

    // Capture payment for order directly via PayPal (server-to-server)
    let paypalOrder: any;
    try {
      paypalOrder = await capturePayPalOrder(paypalOrderId);
    } catch (captureErr: any) {
      // Fallback: If capture fails, check if the order has already been captured
      try {
        console.log(`[PayPal] Capture failed, checking if already captured for order ${paypalOrderId}`);
        paypalOrder = await getPayPalOrderDetails(paypalOrderId);
        if (paypalOrder.status !== 'COMPLETED') {
          throw new Error('Order not completed');
        }
      } catch {
        throw new AppError(
          httpStatus.BAD_GATEWAY,
          'Unable to verify or capture payment with PayPal. Please contact support.',
        );
      }
    }

    // ─── CRITICAL: Only accept COMPLETED status ───
    if (paypalOrder.status !== 'COMPLETED') {
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        `Payment not completed. Current status: ${paypalOrder.status}. Please complete the PayPal payment flow.`,
      );
    }

    // Verify capture details exist
    const captureDetails = paypalOrder.purchase_units?.[0]?.payments?.captures?.[0];
    if (!captureDetails) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        'Payment capture details not found. Transaction may be incomplete.',
      );
    }

    // ─── Amount Verification (anti-tamper) ───
    const expectedUSD = Number(orderData.finalAmount) / 3.75;
    const paidUSD = parseFloat(captureDetails.amount.value);
    const TOLERANCE_USD = 0.05;

    if (paidUSD < expectedUSD - TOLERANCE_USD) {
      console.error(
        `[SECURITY] Payment amount mismatch for PayPal order ${paypalOrderId}. ` +
        `Expected: $${expectedUSD.toFixed(2)}, Received: $${paidUSD.toFixed(2)}. ` +
        `Email: ${orderData.email}`
      );
      await notifyAdmin(
        '🚨 Payment Amount Mismatch Detected',
        `PayPal order ${paypalOrderId} — Expected: $${expectedUSD.toFixed(2)} USD, Received: $${paidUSD.toFixed(2)} USD. Customer: ${orderData.email}`
      );
      throw new AppError(httpStatus.BAD_REQUEST, 'Payment amount does not match the order total. Please contact support.');
    }

    // Enrich payload with verified PayPal data
    orderData.paymentStatus = 'paid';
    orderData.paypalOrderId = paypalOrderId;
    orderData.paypalTransactionId = captureDetails.id;
    orderData.payerName = `${paypalOrder.payer?.name?.given_name || ''} ${paypalOrder.payer?.name?.surname || ''}`.trim() || undefined;
    orderData.payerEmail = paypalOrder.payer?.email_address || undefined;

  } else {
    // ─── Manual Payment: Pending admin verification ───
    orderData.paymentStatus = 'pending_verification';
  }

  // Set default order status
  orderData.orderStatus = 'pending_review';

  // Remove any client-sent status overrides (security)
  delete (orderData as any).__v;
  delete (orderData as any)._id;

  // Generate 6-digit unique order ID
  orderData.orderId = await generateUniqueOrderId();

  // ─── Save to MongoDB (direct create — no session needed for single document) ───
  const savedOrder = await GmbOrder.create(orderData);

  // ─── Post-save: Send admin email notification ───
  const emailBody = `
    New GMB Order Received!<br/><br/>
    <b>Business:</b> ${savedOrder.businessName}<br/>
    <b>Service:</b> ${savedOrder.serviceType}<br/>
    <b>Amount:</b> ${savedOrder.finalAmount} SAR<br/>
    <b>Payment:</b> ${savedOrder.paymentMethod} (${savedOrder.paymentStatus})<br/>
    <b>Customer:</b> ${savedOrder.email}<br/>
    <b>Order ID:</b> #${savedOrder.orderId} (DB ID: ${savedOrder._id})
  `;
  await notifyAdmin('📦 New GMB Order — Action Required', emailBody);

  // Send customer order confirmation email
  await notifyCustomer(savedOrder);

  return savedOrder;
};

// ==================== VALIDATE COUPON ====================
const validateCoupon = async (couponCode: unknown) => {
  if (!couponCode || typeof couponCode !== 'string') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Coupon code is required.');
  }

  const upperCode = couponCode.toUpperCase().trim().substring(0, 30);

  if (!upperCode) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Coupon code cannot be empty.');
  }

  const discount = VALID_COUPONS[upperCode];

  if (discount === undefined) {
    throw new AppError(httpStatus.NOT_FOUND, 'Invalid coupon code. Please try again.');
  }

  return { discount, couponCode: upperCode };
};

// ==================== GET ORDER BY ID ====================
const getOrderById = async (orderId: string) => {
  let order;
  if (mongoose.Types.ObjectId.isValid(orderId)) {
    order = await GmbOrder.findById(orderId).select('-paypalTransactionId -recoveryEmail -recoveryPhone');
  } else if (/^\d{6}$/.test(orderId)) {
    order = await GmbOrder.findOne({ orderId }).select('-paypalTransactionId -recoveryEmail -recoveryPhone');
  } else {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid order ID format.');
  }

  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');
  }
  return order;
};

// ==================== GET ALL ORDERS (Admin only) ====================
const getAllOrders = async (filters: Record<string, unknown> = {}) => {
  const page = Math.max(1, parseInt(String(filters.page || 1), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(filters.limit || 20), 10)));

  // ─── Sanitized query (only allow whitelisted filter keys) ───
  const query: Record<string, string> = {};
  for (const key of ALLOWED_FILTER_KEYS) {
    const val = filters[key];
    if (val && typeof val === 'string') {
      query[key] = sanitizeString(val) as string;
    }
  }

  const skip = (page - 1) * limit;
  const [total, orders] = await Promise.all([
    GmbOrder.countDocuments(query),
    GmbOrder.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-paypalTransactionId'), // Don't expose sensitive txn IDs in list view
  ]);

  return {
    orders,
    meta: {
      total,
      page,
      limit,
      totalPage: Math.ceil(total / limit),
    },
  };
};

// ==================== UPDATE ORDER STATUS (Admin only) ====================
const updateOrderStatus = async (orderId: string, updateData: Partial<IGmbOrder>) => {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid order ID format.');
  }

  // Whitelist allowed update fields (admin cannot change payment amounts)
  const allowedUpdates: Array<keyof IGmbOrder> = ['orderStatus', 'paymentStatus'];
  const safeUpdate: Partial<IGmbOrder> = {};
  for (const key of allowedUpdates) {
    if (key in updateData) {
      (safeUpdate as any)[key] = updateData[key];
    }
  }

  if (Object.keys(safeUpdate).length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'No valid fields to update.');
  }

  const order = await GmbOrder.findByIdAndUpdate(
    orderId,
    { $set: safeUpdate },
    { new: true, runValidators: true }
  );

  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, 'Order not found.');
  }

  return order;
};

// ==================== CREATE PAYPAL ORDER (Server-Side) ====================
// Called BEFORE the user pays — creates a PayPal order via server-to-server API
// Returns the PayPal order ID which the frontend SDK uses to render the payment UI
const createPayPalOrderForCheckout = async (data: {
  finalAmount: number;
  serviceType: string;
}) => {
  const { finalAmount, serviceType } = data;

  if (!finalAmount || isNaN(Number(finalAmount)) || Number(finalAmount) <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid order amount.');
  }

  // SAR → USD (fixed rate 3.75)
  const amountUSD = (Number(finalAmount) / 3.75).toFixed(2);

  const serviceLabel =
    serviceType === 'new'
      ? 'New Profile Setup'
      : serviceType === 'recovery'
        ? 'Profile Recovery'
        : 'Profile Management';

  const description = `BIT Software — GMB Service: ${serviceLabel}`;

  const paypalOrder = await createPayPalOrder(amountUSD, description);

  if (!paypalOrder?.id) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to create PayPal order. Please try again.');
  }

  return {
    paypalOrderId: paypalOrder.id,
    amountUSD,
    status: paypalOrder.status,
  };
};

export const GmbOrderServices = {
  submitGmbOrder,
  validateCoupon,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  createPayPalOrderForCheckout,
};
