// ============================================
// BIT SOFTWARE — Domain Order Service
// ============================================
// ACID-compliant domain purchase flow:
//   1. PayPal capture (server-side verify)
//   2. MongoDB session transaction
//   3. Namecheap domain registration
//   4. Auto-refund if Namecheap fails
//   5. Email notifications
// ============================================

import mongoose from 'mongoose';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { DomainOrder } from './domainOrder.model';
import { IDomainOrder, TSupportedCurrency } from './domainOrder.interface';
import {
  createPayPalOrder,
  capturePayPalOrder,
  refundPayPalCapture,
} from '../../utils/paypal';
import { sendEmail } from '../../utils/sendEmail';
import config from '../../config';

// ─── Fixed Domain Pricing (USD) ───
// Sell price to customer. Your cost is lower (Namecheap charges you separately).
export const DOMAIN_PRICING: Record<string, number> = {
  com: 15,
  net: 17,
  org: 14,
  io: 55,
  co: 32,
  info: 12,
  biz: 17,
  online: 8,
  tech: 35,
  store: 10,
  shop: 22,
  app: 20,
  dev: 14,
  site: 8,
  website: 8,
  cloud: 22,
  digital: 32,
  agency: 32,
  solutions: 22,
  services: 22,
};

export const getDomainPriceUSD = (tld: string): number => {
  return DOMAIN_PRICING[tld.toLowerCase()] ?? 20; // default $20 for unknown TLDs
};

// ─── Currency Conversion ───
// Cache exchange rates for 1 hour to avoid excessive API calls
let rateCache: Record<string, number> | null = null;
let rateCacheTime = 0;
const RATE_CACHE_MS = 60 * 60 * 1000; // 1 hour

const SUPPORTED_CURRENCIES: TSupportedCurrency[] = ['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'];

export const getExchangeRates = async (): Promise<Record<string, number>> => {
  const now = Date.now();
  if (rateCache && (now - rateCacheTime) < RATE_CACHE_MS) {
    return rateCache;
  }

  try {
    const apiKey = process.env.EXCHANGE_RATE_API_KEY;
    let rates: Record<string, number>;

    if (apiKey) {
      // ExchangeRate-API (1500 free requests/month, cache = ~30 req/day max)
      const res = await axios.get(
        `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`,
        { timeout: 8000 },
      );
      rates = res.data.conversion_rates;
    } else {
      // Fallback: free endpoint (no key, limited)
      const res = await axios.get(
        'https://api.exchangerate-api.com/v4/latest/USD',
        { timeout: 8000 },
      );
      rates = res.data.rates;
    }

    // Only keep supported currencies
    const filtered: Record<string, number> = { USD: 1 };
    SUPPORTED_CURRENCIES.forEach((c) => {
      if (rates[c]) filtered[c] = rates[c];
    });

    rateCache = filtered;
    rateCacheTime = now;
    return filtered;
  } catch (err) {
    console.error('[ExchangeRate] API failed, using hardcoded fallback rates:', err);
    // Hardcoded fallback (approximate rates — update periodically)
    return {
      USD: 1,
      SAR: 3.75,
      EUR: 0.92,
      CAD: 1.36,
      BDT: 110,
      PKR: 278,
      INR: 83.5,
    };
  }
};

export const convertFromUSD = async (amountUSD: number, targetCurrency: TSupportedCurrency): Promise<{ displayAmount: number; rate: number }> => {
  if (targetCurrency === 'USD') return { displayAmount: amountUSD, rate: 1 };
  const rates = await getExchangeRates();
  const rate = rates[targetCurrency] ?? 1;
  return {
    displayAmount: parseFloat((amountUSD * rate).toFixed(2)),
    rate,
  };
};

// ─── Generate unique Domain Order ID ───
const generateOrderId = async (): Promise<string> => {
  let id = '';
  let unique = false;
  while (!unique) {
    id = `DOM-${Math.floor(100000 + Math.random() * 900000)}`;
    const existing = await DomainOrder.findOne({ orderId: id });
    if (!existing) unique = true;
  }
  return id;
};

// ─── Namecheap Domain Registration ───
const registerDomainOnNamecheap = async (
  domainName: string,
  years: number,
): Promise<{ namecheapOrderId: string; registeredAt: Date; expiresAt: Date }> => {
  const apiKey = process.env.NAMECHEAP_API_KEY?.trim();
  const apiUser = process.env.NAMECHEAP_API_USER?.trim();
  const clientIp = process.env.NAMECHEAP_CLIENT_IP?.trim() || '127.0.0.1';
  const env = process.env.NAMECHEAP_ENV || 'production';
  const apiUrl = env === 'sandbox'
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response';

  if (!apiKey || !apiUser) {
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Namecheap API not configured.');
  }

  // Registrant contact info from .env (your company info)
  const reg = {
    FirstName: process.env.NC_REG_FIRSTNAME || 'Admin',
    LastName: process.env.NC_REG_LASTNAME || 'BIT',
    Address1: process.env.NC_REG_ADDRESS || 'Riyadh',
    City: process.env.NC_REG_CITY || 'Riyadh',
    StateProvince: process.env.NC_REG_STATE || 'Riyadh',
    PostalCode: process.env.NC_REG_ZIP || '11564',
    Country: process.env.NC_REG_COUNTRY || 'SA',
    Phone: process.env.NC_REG_PHONE || '+966.500000000',
    EmailAddress: process.env.NC_REG_EMAIL || 'admin@bitsoftware.sa',
  };

  const params = new URLSearchParams({
    ApiUser: apiUser,
    ApiKey: apiKey,
    UserName: apiUser,
    ClientIp: clientIp,
    Command: 'namecheap.domains.create',
    DomainName: domainName,
    Years: String(years),
    // Registrant
    RegistrantFirstName: reg.FirstName,
    RegistrantLastName: reg.LastName,
    RegistrantAddress1: reg.Address1,
    RegistrantCity: reg.City,
    RegistrantStateProvince: reg.StateProvince,
    RegistrantPostalCode: reg.PostalCode,
    RegistrantCountry: reg.Country,
    RegistrantPhone: reg.Phone,
    RegistrantEmailAddress: reg.EmailAddress,
    // Tech (same)
    TechFirstName: reg.FirstName,
    TechLastName: reg.LastName,
    TechAddress1: reg.Address1,
    TechCity: reg.City,
    TechStateProvince: reg.StateProvince,
    TechPostalCode: reg.PostalCode,
    TechCountry: reg.Country,
    TechPhone: reg.Phone,
    TechEmailAddress: reg.EmailAddress,
    // Admin (same)
    AdminFirstName: reg.FirstName,
    AdminLastName: reg.LastName,
    AdminAddress1: reg.Address1,
    AdminCity: reg.City,
    AdminStateProvince: reg.StateProvince,
    AdminPostalCode: reg.PostalCode,
    AdminCountry: reg.Country,
    AdminPhone: reg.Phone,
    AdminEmailAddress: reg.EmailAddress,
    // AuxBilling (same)
    AuxBillingFirstName: reg.FirstName,
    AuxBillingLastName: reg.LastName,
    AuxBillingAddress1: reg.Address1,
    AuxBillingCity: reg.City,
    AuxBillingStateProvince: reg.StateProvince,
    AuxBillingPostalCode: reg.PostalCode,
    AuxBillingCountry: reg.Country,
    AuxBillingPhone: reg.Phone,
    AuxBillingEmailAddress: reg.EmailAddress,
    // WHOIS Privacy
    AddFreeWhoisguard: 'yes',
    WGEnabled: 'yes',
  });

  let xmlResponse: string;
  try {
    const res = await axios.post(apiUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000, // 30s — domain registration can take time
    });
    xmlResponse = res.data;
  } catch (err: any) {
    throw new Error(`Namecheap API request failed: ${err.message}`);
  }

  let parsed: any;
  try {
    parsed = await parseStringPromise(xmlResponse, {
      explicitArray: false,
      ignoreAttrs: false,
      mergeAttrs: true,
    });
  } catch {
    throw new Error('Failed to parse Namecheap registration response');
  }

  const apiResponse = parsed?.ApiResponse;
  if (apiResponse?.Status === 'ERROR') {
    const errors = apiResponse.Errors?.Error;
    const msg = Array.isArray(errors)
      ? errors.map((e: any) => e._ || e).join(', ')
      : errors?._ || errors || 'Unknown error';
    throw new Error(`Namecheap Registration Error: ${msg}`);
  }

  const result = apiResponse?.CommandResponse?.DomainCreateResult;
  if (!result || result.Registered !== 'true') {
    throw new Error('Domain registration was not confirmed by Namecheap.');
  }

  const ncOrderId = result.OrderID || result.ChargedAmount ? `NC-${result.OrderID}` : `NC-${Date.now()}`;
  const registeredAt = new Date();
  const expiresAt = new Date(registeredAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + years);

  return { namecheapOrderId: ncOrderId, registeredAt, expiresAt };
};

// ─── SERVICE FUNCTIONS ───

/**
 * STEP 1: Create a pending domain order before payment.
 * Returns the order _id and PayPal order ID.
 */
export const createPayPalOrderForDomain = async (payload: {
  domainName: string;
  displayCurrency: TSupportedCurrency;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  userId: string;
}): Promise<{ orderId: string; dbOrderId: string; paypalOrderId: string; displayAmount: number; displayCurrency: string }> => {
  const { domainName, displayCurrency, customerName, customerEmail, customerPhone, userId } = payload;

  // Parse domain
  const dotIndex = domainName.indexOf('.');
  if (dotIndex < 1) throw new AppError(httpStatus.BAD_REQUEST, 'Invalid domain name.');
  const sld = domainName.substring(0, dotIndex).toLowerCase();
  const tld = domainName.substring(dotIndex + 1).toLowerCase();

  // Check if domain is already active in our system
  const existingActive = await DomainOrder.findOne({
    domainName: domainName.toLowerCase(),
    orderStatus: 'active',
  });
  if (existingActive) {
    throw new AppError(httpStatus.CONFLICT, `Domain "${domainName}" is already registered.`);
  }

  // Pricing
  const sellPriceUSD = getDomainPriceUSD(tld);
  const { displayAmount, rate } = await convertFromUSD(sellPriceUSD, displayCurrency);

  // Create PayPal order (server-side)
  const paypalRes = await createPayPalOrder(
    sellPriceUSD.toFixed(2),
    `Domain Registration: ${domainName} (1 year)`,
    'domain',
  );

  const paypalOrderId = paypalRes.id;
  if (!paypalOrderId) throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to create PayPal order.');

  // Generate order ID
  const orderId = await generateOrderId();

  // Save pending order
  const domainOrder = await DomainOrder.create({
    orderId,
    userId: new mongoose.Types.ObjectId(userId),
    domainName: domainName.toLowerCase(),
    sld,
    tld,
    registrationYears: 1,
    whoisPrivacy: true,
    sellPriceUSD,
    displayCurrency,
    displayAmount,
    exchangeRateUsed: rate,
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
    dbOrderId: domainOrder._id.toString(),
    paypalOrderId,
    displayAmount,
    displayCurrency,
  };
};

/**
 * STEP 2: Complete purchase — atomic ACID transaction.
 * Called after customer approves PayPal payment.
 */
export const completeDomainPurchase = async (payload: {
  paypalOrderId: string;
  userId: string;
}): Promise<IDomainOrder> => {
  const { paypalOrderId, userId } = payload;

  // ─── Find the pending order ───
  const pendingOrder = await DomainOrder.findOne({
    paypalOrderId,
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: 'pending_payment',
    paymentStatus: 'pending',
  });

  if (!pendingOrder) {
    // Idempotency: check if already completed
    const completed = await DomainOrder.findOne({ paypalOrderId, userId: new mongoose.Types.ObjectId(userId) });
    if (completed && completed.orderStatus === 'active') {
      return completed.toObject() as IDomainOrder;
    }
    throw new AppError(httpStatus.NOT_FOUND, 'Pending domain order not found. Payment may have already been processed.');
  }

  // ─── Start MongoDB Session (ACID) ───
  const session = await mongoose.startSession();
  let captureId: string | null = null;

  try {
    session.startTransaction();

    // 1. Capture PayPal payment (server-side — prevent spoofing)
    let captureResult: any;
    try {
      captureResult = await capturePayPalOrder(paypalOrderId);
    } catch (err: any) {
      await session.abortTransaction();
      throw new AppError(httpStatus.PAYMENT_REQUIRED, `PayPal capture failed: ${err.message}`);
    }

    // 2. Verify capture status and amount
    const captureStatus = captureResult?.status;
    if (captureStatus !== 'COMPLETED') {
      await session.abortTransaction();
      throw new AppError(httpStatus.PAYMENT_REQUIRED, `PayPal payment not completed. Status: ${captureStatus}`);
    }

    const captureUnit = captureResult?.purchase_units?.[0]?.payments?.captures?.[0];
    captureId = captureUnit?.id ?? null;
    const capturedAmountUSD = parseFloat(captureUnit?.amount?.value ?? '0');
    const capturedCurrency = captureUnit?.amount?.currency_code ?? 'USD';

    // Verify correct currency and amount (allow 1 cent tolerance for float)
    if (capturedCurrency !== 'USD' || Math.abs(capturedAmountUSD - pendingOrder.sellPriceUSD) > 0.01) {
      // Refund immediately — wrong amount
      if (captureId) {
        try { await refundPayPalCapture(captureId, capturedAmountUSD.toFixed(2), 'USD'); } catch { /* log only */ }
      }
      await session.abortTransaction();
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        `Payment amount mismatch. Expected $${pendingOrder.sellPriceUSD} USD, got $${capturedAmountUSD} ${capturedCurrency}.`,
      );
    }

    // 3. Update order → processing [within session]
    await DomainOrder.updateOne(
      { _id: pendingOrder._id },
      {
        $set: {
          paymentStatus: 'paid',
          orderStatus: 'processing',
          paypalCaptureId: captureId,
          paypalTransactionId: captureUnit?.id,
        },
      },
      { session },
    );

    // 4. Register domain on Namecheap
    let ncResult: { namecheapOrderId: string; registeredAt: Date; expiresAt: Date } | null = null;
    let registrationError: string | null = null;

    try {
      ncResult = await registerDomainOnNamecheap(pendingOrder.domainName, pendingOrder.registrationYears);
    } catch (err: any) {
      registrationError = err.message || 'Domain registration failed';
      console.error('[DomainPurchase] Namecheap registration failed:', registrationError);
    }

    if (ncResult) {
      // 5a. SUCCESS — update order to active
      await DomainOrder.updateOne(
        { _id: pendingOrder._id },
        {
          $set: {
            orderStatus: 'active',
            namecheapOrderId: ncResult.namecheapOrderId,
            registeredAt: ncResult.registeredAt,
            expiresAt: ncResult.expiresAt,
          },
        },
        { session },
      );

      await session.commitTransaction();

      // Send success email (outside transaction — non-critical)
      try {
        await sendEmail(
          pendingOrder.customerEmail,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #4F46E5;">Domain Registration Successful!</h2>
              <p>Dear ${pendingOrder.customerName},</p>
              <p>Your domain <strong>${pendingOrder.domainName}</strong> has been successfully registered.</p>
              <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
                <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Domain</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.domainName}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Registered</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${ncResult.registeredAt.toDateString()}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Expires</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${ncResult.expiresAt.toDateString()}</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Amount Paid</td><td style="padding: 8px; border: 1px solid #e5e7eb;">$${pendingOrder.sellPriceUSD} USD</td></tr>
                <tr><td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">Order ID</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${pendingOrder.orderId}</td></tr>
              </table>
              <p>You can manage your domain from <a href="${process.env.FRONTEND_URL}/my-account">My Account</a>.</p>
              <p>Thank you for choosing BIT Software & IT Solution!</p>
            </div>
          `,
          `✅ Domain "${pendingOrder.domainName}" Successfully Registered — BIT Software`,
        );
      } catch (emailErr) {
        console.error('[DomainPurchase] Success email failed:', emailErr);
      }
    } else {
      // 5b. FAILURE — refund PayPal, mark order failed
      let refundId: string | null = null;
      if (captureId) {
        try {
          const refundResult = await refundPayPalCapture(captureId, pendingOrder.sellPriceUSD.toFixed(2), 'USD');
          refundId = refundResult?.id ?? null;
          console.log(`[DomainPurchase] PayPal refunded. Refund ID: ${refundId}`);
        } catch (refundErr: any) {
          // Log but don't throw — admin needs to manually refund
          console.error('[DomainPurchase] AUTO REFUND FAILED — MANUAL ACTION REQUIRED:', refundErr.message);
        }
      }

      await DomainOrder.updateOne(
        { _id: pendingOrder._id },
        {
          $set: {
            orderStatus: 'failed',
            paymentStatus: refundId ? 'refunded' : 'paid', // if refund failed, stays as paid for manual review
            failureReason: registrationError,
            paypalRefundId: refundId ?? undefined,
            refundedAt: refundId ? new Date() : undefined,
          },
        },
        { session },
      );

      await session.commitTransaction();

      // Send failure + refund email
      try {
        await sendEmail(
          pendingOrder.customerEmail,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #EF4444;">Domain Registration Failed</h2>
              <p>Dear ${pendingOrder.customerName},</p>
              <p>We're sorry, the registration of <strong>${pendingOrder.domainName}</strong> could not be completed.</p>
              ${refundId
                ? `<p style="color: #10B981; font-weight: bold;">✅ A full refund of $${pendingOrder.sellPriceUSD} USD has been automatically initiated to your PayPal account. Refund ID: ${refundId}</p>`
                : `<p style="color: #F59E0B; font-weight: bold;">⚠️ We were unable to automatically process your refund. Our team will contact you within 24 hours to resolve this manually.</p>`
              }
              <p><strong>Order ID:</strong> ${pendingOrder.orderId}</p>
              <p>We apologize for the inconvenience. Please contact us at <a href="mailto:${config.smtp_user}">${config.smtp_user}</a> if you need help.</p>
            </div>
          `,
          '⚠️ Domain Registration Failed — Refund Initiated — BIT Software',
        );
      } catch (emailErr) {
        console.error('[DomainPurchase] Failure email error:', emailErr);
      }

      throw new AppError(
        httpStatus.BAD_GATEWAY,
        refundId
          ? `Domain registration failed. A full refund of $${pendingOrder.sellPriceUSD} USD has been issued. Refund ID: ${refundId}`
          : `Domain registration failed and auto-refund was unsuccessful. Please contact support. Order ID: ${pendingOrder.orderId}`,
      );
    }

    const finalOrder = await DomainOrder.findById(pendingOrder._id).lean();
    return finalOrder as IDomainOrder;
  } catch (err) {
    // Only abort if transaction is still active
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * Get a user's registered domains.
 */
export const getUserDomains = async (userId: string) => {
  return DomainOrder.find({
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: { $in: ['active', 'processing', 'failed'] },
  })
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Get all domain orders (admin).
 */
export const getAllDomainOrders = async (query: Record<string, unknown>) => {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.orderStatus) filter.orderStatus = query.orderStatus;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  if (query.tld) filter.tld = query.tld;

  const [orders, total] = await Promise.all([
    DomainOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name email').lean(),
    DomainOrder.countDocuments(filter),
  ]);

  return {
    orders,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Get single domain order by ID.
 */
export const getDomainOrderById = async (orderId: string, userId?: string) => {
  const filter: Record<string, unknown> = { _id: orderId };
  if (userId) filter.userId = new mongoose.Types.ObjectId(userId); // user can only see their own
  const order = await DomainOrder.findOne(filter).lean();
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Domain order not found.');
  return order;
};

/**
 * Admin: update domain order status manually.
 */
export const updateDomainOrderStatus = async (
  orderId: string,
  updates: Partial<Pick<IDomainOrder, 'orderStatus' | 'paymentStatus' | 'failureReason' | 'namecheapOrderId'>>,
) => {
  const order = await DomainOrder.findByIdAndUpdate(orderId, { $set: updates }, { new: true, runValidators: true });
  if (!order) throw new AppError(httpStatus.NOT_FOUND, 'Domain order not found.');
  return order;
};

/**
 * Exchange rates endpoint (public — for UI currency display).
 */
export const getPublicExchangeRates = async () => {
  return getExchangeRates();
};
