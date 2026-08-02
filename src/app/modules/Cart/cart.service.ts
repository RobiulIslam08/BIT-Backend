// ============================================
// BIT SOFTWARE — Cart Checkout Service
// ============================================
// Multi-item checkout: one PayPal/wallet payment → fulfill domain + hosting lines.
// Browse cart lives on the client; this module only handles checkout payment.

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { CartCheckout } from './cart.model';
import {
  ICartCheckout,
  ICartLineResult,
  TCartItemInput,
  TSupportedCurrency,
} from './cart.interface';
import { DomainOrder } from '../DomainOrder/domainOrder.model';
import {
  convertFromUSD,
  registerDomainOnNamecheap,
} from '../DomainOrder/domainOrder.service';
import { getDomainPriceUSD } from '../DomainPricing/domainPricing.service';
import { Domain } from '../Domain/domainAsset.model';
import { checkDomainAvailability } from '../Domain/domain.service';
import { upsertDomainFromOrder } from '../Domain/domainAsset.service';
import { HostingOrder } from '../HostingOrder/hostingOrder.model';
import { Hosting } from '../Hosting/hosting.model';
import { getActivePlanBySlug } from '../HostingPlan/hostingPlan.service';
import { THostingBillingCycle } from '../HostingOrder/hostingOrder.interface';
import {
  createPayPalOrder,
  capturePayPalOrder,
  refundPayPalCapture,
} from '../../utils/paypal';
import { WalletService } from '../Wallet/wallet.service';
import { sendEmail } from '../../utils/sendEmail';
import config from '../../config';

type PreparedDomainLine = {
  type: 'domain';
  domainName: string;
  sld: string;
  tld: string;
  sellPriceUSD: number;
  label: string;
};

type PreparedHostingLine = {
  type: 'hosting';
  planSlug: string;
  planName: string;
  planType: 'shared' | 'vps';
  billingCycle: THostingBillingCycle;
  features: string[];
  websiteLabel?: string;
  attachedDomain?: string;
  hostingPlanId: mongoose.Types.ObjectId;
  sellPriceUSD: number;
  label: string;
};

type PreparedLine = PreparedDomainLine | PreparedHostingLine;

const addBillingPeriod = (base: Date, cycle: THostingBillingCycle): Date => {
  const d = new Date(base);
  if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
};

const generateCartCheckoutId = async (): Promise<string> => {
  let id = '';
  let unique = false;
  while (!unique) {
    id = `CART-${Math.floor(100000 + Math.random() * 900000)}`;
    const existing = await CartCheckout.findOne({ cartCheckoutId: id });
    if (!existing) unique = true;
  }
  return id;
};

const generateDomainOrderId = async (): Promise<string> => {
  let id = '';
  let unique = false;
  while (!unique) {
    id = `DOM-${Math.floor(100000 + Math.random() * 900000)}`;
    const existing = await DomainOrder.findOne({ orderId: id });
    if (!existing) unique = true;
  }
  return id;
};

const generateHostingOrderId = async (): Promise<string> => {
  let id = '';
  let unique = false;
  while (!unique) {
    id = `HST-${Math.floor(100000 + Math.random() * 900000)}`;
    const existing = await HostingOrder.findOne({ orderId: id });
    if (!existing) unique = true;
  }
  return id;
};

const getAdminEmail = (): string =>
  process.env.ADMIN_EMAIL?.trim() || config.smtp_user || 'admin@bitsoftwareitsolution.com';

const parseDomainName = (domainName: string) => {
  const normalized = domainName.trim().toLowerCase();
  const dotIndex = normalized.indexOf('.');
  if (dotIndex < 1) throw new AppError(httpStatus.BAD_REQUEST, `Invalid domain name: ${domainName}`);
  return {
    domainName: normalized,
    sld: normalized.substring(0, dotIndex),
    tld: normalized.substring(dotIndex + 1),
  };
};

/**
 * Validate + price every cart line server-side (never trust client prices).
 */
const prepareCartItems = async (items: TCartItemInput[]): Promise<PreparedLine[]> => {
  if (!items?.length) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Cart is empty.');
  }
  if (items.length > 20) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Cart cannot exceed 20 items.');
  }

  const domainNames = new Set<string>();
  const hostingKeys = new Set<string>();
  const prepared: PreparedLine[] = [];

  for (const item of items) {
    if (item.type === 'domain') {
      const { domainName, sld, tld } = parseDomainName(item.domainName);
      if (domainNames.has(domainName)) {
        throw new AppError(httpStatus.BAD_REQUEST, `Duplicate domain in cart: ${domainName}`);
      }
      domainNames.add(domainName);

      const existingActive = await DomainOrder.findOne({
        domainName,
        orderStatus: { $in: ['processing', 'active'] },
      });
      if (existingActive) {
        throw new AppError(
          httpStatus.CONFLICT,
          `Domain "${domainName}" is already registered or being registered.`,
        );
      }
      const existingAsset = await Domain.findOne({ domainName }).lean();
      if (existingAsset) {
        throw new AppError(
          httpStatus.CONFLICT,
          `Domain "${domainName}" is already registered in our system.`,
        );
      }

      const availability = await checkDomainAvailability(domainName);
      if (!availability.primaryResult?.available) {
        throw new AppError(httpStatus.CONFLICT, `Domain "${domainName}" is not available.`);
      }

      const sellPriceUSD = await getDomainPriceUSD(tld);
      prepared.push({
        type: 'domain',
        domainName,
        sld,
        tld,
        sellPriceUSD,
        label: domainName,
      });
      continue;
    }

    if (item.type === 'hosting') {
      const planSlug = item.planSlug.trim().toLowerCase();
      const billingCycle = item.billingCycle;
      if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
        throw new AppError(httpStatus.BAD_REQUEST, 'billingCycle must be monthly or yearly.');
      }
      const key = `${planSlug}:${billingCycle}`;
      if (hostingKeys.has(key)) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Duplicate hosting plan in cart: ${planSlug} (${billingCycle}).`,
        );
      }
      hostingKeys.add(key);

      const plan = await getActivePlanBySlug(planSlug);
      const sellPriceUSD =
        billingCycle === 'monthly' ? plan.monthlyPriceUSD : plan.yearlyPriceUSD;
      if (typeof sellPriceUSD !== 'number' || sellPriceUSD <= 0) {
        throw new AppError(httpStatus.BAD_REQUEST, `Invalid pricing for plan "${planSlug}".`);
      }

      const attachedDomain = item.attachedDomain?.trim().toLowerCase() || undefined;
      const websiteLabel =
        item.websiteLabel?.trim() || attachedDomain || undefined;

      prepared.push({
        type: 'hosting',
        planSlug: plan.slug,
        planName: plan.name,
        planType: plan.planType,
        billingCycle,
        features: plan.features || [],
        websiteLabel,
        attachedDomain,
        hostingPlanId: (plan as any)._id,
        sellPriceUSD,
        label: `${plan.name} (${billingCycle})`,
      });
    }
  }

  return prepared;
};

const createPendingLineOrders = async (params: {
  prepared: PreparedLine[];
  cartCheckoutId: string;
  userId: string;
  displayCurrency: TSupportedCurrency;
  displayAmount: number;
  rate: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  paymentMethod: 'paypal' | 'wallet';
  session?: mongoose.ClientSession;
}): Promise<{ domainOrderIds: mongoose.Types.ObjectId[]; hostingOrderIds: mongoose.Types.ObjectId[] }> => {
  const {
    prepared,
    cartCheckoutId,
    userId,
    displayCurrency,
    rate,
    customerName,
    customerEmail,
    customerPhone,
    paymentMethod,
    session,
  } = params;

  const domainOrderIds: mongoose.Types.ObjectId[] = [];
  const hostingOrderIds: mongoose.Types.ObjectId[] = [];
  const userOid = new mongoose.Types.ObjectId(userId);

  for (const line of prepared) {
    if (line.type === 'domain') {
      const orderId = await generateDomainOrderId();
      const lineDisplay = await convertFromUSD(line.sellPriceUSD, displayCurrency);
      const [order] = await DomainOrder.create(
        [
          {
            orderId,
            userId: userOid,
            domainName: line.domainName,
            sld: line.sld,
            tld: line.tld,
            registrationYears: 1,
            whoisPrivacy: true,
            sellPriceUSD: line.sellPriceUSD,
            displayCurrency,
            displayAmount: lineDisplay.displayAmount,
            exchangeRateUsed: rate,
            paymentMethod,
            paymentStatus: 'pending',
            orderStatus: 'pending_payment',
            customerName,
            customerEmail,
            customerPhone,
            cartCheckoutId,
          },
        ],
        session ? { session } : undefined,
      );
      domainOrderIds.push(order._id);
    } else {
      const orderId = await generateHostingOrderId();
      const lineDisplay = await convertFromUSD(line.sellPriceUSD, displayCurrency);
      const [order] = await HostingOrder.create(
        [
          {
            orderId,
            userId: userOid,
            planSlug: line.planSlug,
            planName: line.planName,
            planType: line.planType,
            billingCycle: line.billingCycle,
            features: line.features,
            websiteLabel: line.websiteLabel,
            attachedDomain: line.attachedDomain,
            sellPriceUSD: line.sellPriceUSD,
            displayCurrency,
            displayAmount: lineDisplay.displayAmount,
            exchangeRateUsed: rate,
            paymentMethod,
            paymentStatus: 'pending',
            orderStatus: 'pending_payment',
            hostingPlanId: line.hostingPlanId,
            customerName,
            customerEmail,
            customerPhone,
            cartCheckoutId,
          },
        ],
        session ? { session } : undefined,
      );
      hostingOrderIds.push(order._id);
    }
  }

  return { domainOrderIds, hostingOrderIds };
};

const fulfillDomainLine = async (
  orderDoc: any,
): Promise<ICartLineResult> => {
  const label = orderDoc.domainName as string;
  try {
    await DomainOrder.updateOne(
      { _id: orderDoc._id },
      { $set: { paymentStatus: 'paid', orderStatus: 'processing' } },
    );

    const ncResult = await registerDomainOnNamecheap(
      orderDoc.domainName,
      orderDoc.registrationYears || 1,
    );

    await DomainOrder.updateOne(
      { _id: orderDoc._id },
      {
        $set: {
          orderStatus: 'active',
          namecheapOrderId: ncResult.namecheapOrderId,
          registeredAt: ncResult.registeredAt,
          expiresAt: ncResult.expiresAt,
        },
      },
    );

    try {
      await upsertDomainFromOrder({
        _id: orderDoc._id,
        userId: orderDoc.userId,
        domainName: orderDoc.domainName,
        sld: orderDoc.sld,
        tld: orderDoc.tld,
        registrationYears: orderDoc.registrationYears,
        whoisPrivacy: orderDoc.whoisPrivacy,
        registeredAt: ncResult.registeredAt,
        expiresAt: ncResult.expiresAt,
      });
    } catch (assetErr) {
      console.error('[CartCheckout] Domain asset upsert failed:', assetErr);
    }

    return {
      type: 'domain',
      label,
      sellPriceUSD: orderDoc.sellPriceUSD,
      status: 'active',
      orderId: orderDoc.orderId,
      dbOrderId: orderDoc._id.toString(),
    };
  } catch (err: any) {
    const reason = err?.message || 'Domain registration failed';
    await DomainOrder.updateOne(
      { _id: orderDoc._id },
      {
        $set: {
          orderStatus: 'failed',
          paymentStatus: 'paid',
          failureReason: reason,
        },
      },
    );
    return {
      type: 'domain',
      label,
      sellPriceUSD: orderDoc.sellPriceUSD,
      status: 'failed',
      orderId: orderDoc.orderId,
      dbOrderId: orderDoc._id.toString(),
      failureReason: reason,
    };
  }
};

const fulfillHostingLine = async (orderDoc: any): Promise<ICartLineResult> => {
  const label = `${orderDoc.planName} (${orderDoc.billingCycle})`;
  try {
    const now = new Date();
    const expiresAt = addBillingPeriod(now, orderDoc.billingCycle);

    const [asset] = await Hosting.create([
      {
        userId: orderDoc.userId,
        planSlug: orderDoc.planSlug,
        planName: orderDoc.planName,
        planType: orderDoc.planType,
        billingCycle: orderDoc.billingCycle,
        features: orderDoc.features || [],
        websiteLabel: orderDoc.websiteLabel || orderDoc.attachedDomain,
        source: 'purchase',
        status: 'active',
        startsAt: now,
        expiresAt,
        amountUSD: orderDoc.sellPriceUSD,
        renewPriceUSD: orderDoc.sellPriceUSD,
        hostingOrderId: orderDoc._id,
        hostingPlanId: orderDoc.hostingPlanId,
      },
    ]);

    await HostingOrder.updateOne(
      { _id: orderDoc._id },
      {
        $set: {
          paymentStatus: 'paid',
          orderStatus: 'active',
          startsAt: now,
          expiresAt,
          hostingAssetId: asset._id,
        },
      },
    );

    return {
      type: 'hosting',
      label,
      sellPriceUSD: orderDoc.sellPriceUSD,
      status: 'active',
      orderId: orderDoc.orderId,
      dbOrderId: orderDoc._id.toString(),
    };
  } catch (err: any) {
    const reason = err?.message || 'Hosting activation failed';
    await HostingOrder.updateOne(
      { _id: orderDoc._id },
      {
        $set: {
          orderStatus: 'failed',
          paymentStatus: 'paid',
          failureReason: reason,
        },
      },
    );
    return {
      type: 'hosting',
      label,
      sellPriceUSD: orderDoc.sellPriceUSD,
      status: 'failed',
      orderId: orderDoc.orderId,
      dbOrderId: orderDoc._id.toString(),
      failureReason: reason,
    };
  }
};

const refundFailedLines = async (params: {
  lineResults: ICartLineResult[];
  captureId: string | null;
  paymentMethod: 'paypal' | 'wallet';
  userId: string;
  cartCheckoutId: string;
  walletPromoUsed?: number;
  walletAccountUsed?: number;
}): Promise<ICartLineResult[]> => {
  const {
    lineResults,
    captureId,
    paymentMethod,
    userId,
    cartCheckoutId,
    walletPromoUsed = 0,
    walletAccountUsed = 0,
  } = params;

  const failed = lineResults.filter((l) => l.status === 'failed');
  if (!failed.length) return lineResults;

  const failedTotal = failed.reduce((sum, l) => sum + l.sellPriceUSD, 0);
  if (failedTotal <= 0) return lineResults;

  if (paymentMethod === 'paypal' && captureId) {
    try {
      await refundPayPalCapture(captureId, failedTotal.toFixed(2), 'USD');
      return lineResults.map((l) =>
        l.status === 'failed'
          ? { ...l, refundedUSD: l.sellPriceUSD }
          : l,
      );
    } catch (err) {
      console.error('[CartCheckout] Partial PayPal refund FAILED:', err);
      return lineResults;
    }
  }

  if (paymentMethod === 'wallet') {
    // Refund failed portion proportionally across promo/account used on the cart debit.
    const cartTotal = lineResults.reduce((s, l) => s + l.sellPriceUSD, 0) || 1;
    const promoShare = (walletPromoUsed / cartTotal) * failedTotal;
    const accountShare = (walletAccountUsed / cartTotal) * failedTotal;
    try {
      await WalletService.refundToWallet({
        userId,
        accountAmount: accountShare,
        promoAmount: promoShare,
        reference: { kind: 'cart_checkout', id: cartCheckoutId },
        note: `Partial cart refund for failed lines (${cartCheckoutId})`,
      });
      return lineResults.map((l) =>
        l.status === 'failed'
          ? { ...l, refundedUSD: l.sellPriceUSD }
          : l,
      );
    } catch (err) {
      console.error('[CartCheckout] Partial wallet refund FAILED:', err);
      return lineResults;
    }
  }

  return lineResults;
};

const summarizeStatus = (
  lineResults: ICartLineResult[],
): { status: ICartCheckout['status']; paymentStatus: ICartCheckout['paymentStatus'] } => {
  const active = lineResults.filter((l) => l.status === 'active').length;
  const failed = lineResults.filter((l) => l.status === 'failed').length;
  const refundedAny = lineResults.some((l) => (l.refundedUSD || 0) > 0);

  if (active > 0 && failed === 0) {
    return { status: 'completed', paymentStatus: 'paid' };
  }
  if (active > 0 && failed > 0) {
    return {
      status: 'partial',
      paymentStatus: refundedAny ? 'partially_refunded' : 'paid',
    };
  }
  return {
    status: 'failed',
    paymentStatus: refundedAny ? 'refunded' : 'paid',
  };
};

const sendCartEmails = async (
  checkout: ICartCheckout,
  lineResults: ICartLineResult[],
) => {
  const rows = lineResults
    .map(
      (l) =>
        `<tr>
          <td style="padding:8px;border:1px solid #e5e7eb;">${l.label}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">$${l.sellPriceUSD.toFixed(2)}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${l.status}${l.failureReason ? ` — ${l.failureReason}` : ''}</td>
        </tr>`,
    )
    .join('');

  try {
    await sendEmail(
      checkout.customerEmail,
      `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
          <h2 style="color:#4F46E5;">Cart Checkout Update</h2>
          <p>Dear ${checkout.customerName},</p>
          <p>Your cart checkout <strong>${checkout.cartCheckoutId}</strong> has been processed.</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0;">
            <tr>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Item</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Price</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Status</th>
            </tr>
            ${rows}
          </table>
          <p>Manage purchases from <a href="${process.env.FRONTEND_URL}/my-account">My Account</a>.</p>
        </div>
      `,
      `Cart Checkout ${checkout.cartCheckoutId} — BIT Software`,
    );
  } catch (err) {
    console.error('[CartCheckout] Customer email failed:', err);
  }

  try {
    await sendEmail(
      getAdminEmail(),
      `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
          <h2>Cart Checkout ${checkout.cartCheckoutId}</h2>
          <p>${checkout.customerName} (${checkout.customerEmail}) — $${checkout.sellPriceUSD} USD</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0;">
            ${rows}
          </table>
        </div>
      `,
      `🛒 Cart Checkout ${checkout.cartCheckoutId}`,
    );
  } catch (err) {
    console.error('[CartCheckout] Admin email failed:', err);
  }
};

/**
 * STEP 1 — Create pending line orders + one PayPal order for the cart total.
 */
export const createCartPayPalOrder = async (payload: {
  items: TCartItemInput[];
  displayCurrency: TSupportedCurrency;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  userId: string;
}) => {
  const {
    items,
    displayCurrency,
    customerName,
    customerEmail,
    customerPhone,
    userId,
  } = payload;

  const prepared = await prepareCartItems(items);
  const sellPriceUSD = prepared.reduce((sum, l) => sum + l.sellPriceUSD, 0);
  if (sellPriceUSD <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Cart total must be greater than zero.');
  }

  const { displayAmount, rate } = await convertFromUSD(sellPriceUSD, displayCurrency);
  const cartCheckoutId = await generateCartCheckoutId();

  const descriptionParts = prepared.map((l) => l.label).slice(0, 3);
  const more = prepared.length > 3 ? ` +${prepared.length - 3} more` : '';
  const paypalRes = await createPayPalOrder(
    sellPriceUSD.toFixed(2),
    `Cart: ${descriptionParts.join(', ')}${more}`,
    'cart',
  );
  const paypalOrderId = paypalRes.id;
  if (!paypalOrderId) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to create PayPal order.');
  }

  const { domainOrderIds, hostingOrderIds } = await createPendingLineOrders({
    prepared,
    cartCheckoutId,
    userId,
    displayCurrency,
    displayAmount,
    rate,
    customerName,
    customerEmail,
    customerPhone,
    paymentMethod: 'paypal',
  });

  const checkout = await CartCheckout.create({
    cartCheckoutId,
    userId: new mongoose.Types.ObjectId(userId),
    sellPriceUSD,
    displayCurrency,
    displayAmount,
    exchangeRateUsed: rate,
    paymentMethod: 'paypal',
    paymentStatus: 'pending',
    paypalOrderId,
    status: 'pending_payment',
    customerName,
    customerEmail,
    customerPhone,
    domainOrderIds,
    hostingOrderIds,
    lineResults: prepared.map((l) => ({
      type: l.type,
      label: l.label,
      sellPriceUSD: l.sellPriceUSD,
      status: 'pending' as const,
    })),
  });

  return {
    cartCheckoutId,
    dbCheckoutId: checkout._id.toString(),
    paypalOrderId,
    displayAmount,
    displayCurrency,
    sellPriceUSD,
    itemCount: prepared.length,
  };
};

/**
 * STEP 2 — Capture PayPal and fulfill each pending line.
 */
export const completeCartPurchase = async (payload: {
  paypalOrderId: string;
  userId: string;
}): Promise<ICartCheckout> => {
  const { paypalOrderId, userId } = payload;

  const checkout = await CartCheckout.findOne({
    paypalOrderId,
    userId: new mongoose.Types.ObjectId(userId),
  });

  if (!checkout) {
    throw new AppError(httpStatus.NOT_FOUND, 'Cart checkout not found.');
  }

  if (checkout.status === 'completed' || checkout.status === 'partial') {
    return checkout.toObject() as ICartCheckout;
  }

  if (checkout.status !== 'pending_payment' || checkout.paymentStatus !== 'pending') {
    throw new AppError(
      httpStatus.CONFLICT,
      'This cart checkout is no longer awaiting payment.',
    );
  }

  let captureResult: any;
  try {
    captureResult = await capturePayPalOrder(paypalOrderId);
  } catch (err: any) {
    throw new AppError(httpStatus.PAYMENT_REQUIRED, `PayPal capture failed: ${err.message}`);
  }

  if (captureResult?.status !== 'COMPLETED') {
    throw new AppError(
      httpStatus.PAYMENT_REQUIRED,
      `PayPal payment not completed. Status: ${captureResult?.status}`,
    );
  }

  const captureUnit = captureResult?.purchase_units?.[0]?.payments?.captures?.[0];
  const captureId = captureUnit?.id ?? null;
  const capturedAmountUSD = parseFloat(captureUnit?.amount?.value ?? '0');
  const capturedCurrency = captureUnit?.amount?.currency_code ?? 'USD';

  if (
    capturedCurrency !== 'USD' ||
    Math.abs(capturedAmountUSD - checkout.sellPriceUSD) > 0.01
  ) {
    if (captureId) {
      try {
        await refundPayPalCapture(captureId, capturedAmountUSD.toFixed(2), 'USD');
      } catch {
        /* log only */
      }
    }
    throw new AppError(
      httpStatus.PAYMENT_REQUIRED,
      `Payment amount mismatch. Expected $${checkout.sellPriceUSD} USD, got $${capturedAmountUSD} ${capturedCurrency}.`,
    );
  }

  await CartCheckout.updateOne(
    { _id: checkout._id },
    {
      $set: {
        paymentStatus: 'paid',
        status: 'processing',
        paypalCaptureId: captureId,
        paypalTransactionId: captureUnit?.id,
      },
    },
  );

  // Do not copy paypalCaptureId onto line orders — those fields are unique-sparse
  // and one capture belongs to the parent CartCheckout document only.

  const domainOrders = await DomainOrder.find({ _id: { $in: checkout.domainOrderIds } });
  const hostingOrders = await HostingOrder.find({ _id: { $in: checkout.hostingOrderIds } });

  const lineResults: ICartLineResult[] = [];
  for (const order of domainOrders) {
    lineResults.push(await fulfillDomainLine(order));
  }
  for (const order of hostingOrders) {
    lineResults.push(await fulfillHostingLine(order));
  }

  const refundedResults = await refundFailedLines({
    lineResults,
    captureId,
    paymentMethod: 'paypal',
    userId,
    cartCheckoutId: checkout.cartCheckoutId,
  });

  // Mark refunded failed domain/hosting paymentStatus
  for (const line of refundedResults) {
    if (line.status === 'failed' && (line.refundedUSD || 0) > 0 && line.dbOrderId) {
      if (line.type === 'domain') {
        await DomainOrder.updateOne(
          { _id: line.dbOrderId },
          { $set: { paymentStatus: 'refunded', refundedAt: new Date() } },
        );
      } else {
        await HostingOrder.updateOne(
          { _id: line.dbOrderId },
          { $set: { paymentStatus: 'refunded', refundedAt: new Date() } },
        );
      }
    }
  }

  const summary = summarizeStatus(refundedResults);
  await CartCheckout.updateOne(
    { _id: checkout._id },
    {
      $set: {
        status: summary.status,
        paymentStatus: summary.paymentStatus,
        lineResults: refundedResults,
      },
    },
  );

  const refreshed = await CartCheckout.findById(checkout._id).lean();
  if (refreshed) {
    await sendCartEmails(refreshed as ICartCheckout, refundedResults);
  }
  return refreshed as ICartCheckout;
};

/**
 * One-step wallet cart checkout.
 */
export const payCartWithWallet = async (payload: {
  items: TCartItemInput[];
  displayCurrency: TSupportedCurrency;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  userId: string;
}): Promise<ICartCheckout> => {
  const {
    items,
    displayCurrency,
    customerName,
    customerEmail,
    customerPhone,
    userId,
  } = payload;

  const prepared = await prepareCartItems(items);
  const sellPriceUSD = prepared.reduce((sum, l) => sum + l.sellPriceUSD, 0);
  if (sellPriceUSD <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Cart total must be greater than zero.');
  }

  const { displayAmount, rate } = await convertFromUSD(sellPriceUSD, displayCurrency);
  const cartCheckoutId = await generateCartCheckoutId();

  type WalletSpend = { promoUsed: number; accountUsed: number; transactionId: string };
  const session = await mongoose.startSession();
  let checkoutOid: mongoose.Types.ObjectId | null = null;
  let walletSpend: WalletSpend | null = null;
  let domainOrderIds: mongoose.Types.ObjectId[] = [];
  let hostingOrderIds: mongoose.Types.ObjectId[] = [];

  try {
    await session.withTransaction(async () => {
      const spend = await WalletService.spendFromWallet({
        userId,
        amountUSD: sellPriceUSD,
        reference: { kind: 'cart_checkout', id: cartCheckoutId },
        note: `Cart checkout (${prepared.length} items)`,
        session,
      });
      walletSpend = spend;

      const created = await createPendingLineOrders({
        prepared,
        cartCheckoutId,
        userId,
        displayCurrency,
        displayAmount,
        rate,
        customerName,
        customerEmail,
        customerPhone,
        paymentMethod: 'wallet',
        session,
      });
      domainOrderIds = created.domainOrderIds;
      hostingOrderIds = created.hostingOrderIds;

      // Mark lines paid/processing inside txn
      await DomainOrder.updateMany(
        { _id: { $in: domainOrderIds } },
        {
          $set: {
            paymentStatus: 'paid',
            orderStatus: 'processing',
            walletTransactionId: new mongoose.Types.ObjectId(spend.transactionId),
            walletPromoUsed: spend.promoUsed,
            walletAccountUsed: spend.accountUsed,
          },
        },
        { session },
      );
      await HostingOrder.updateMany(
        { _id: { $in: hostingOrderIds } },
        {
          $set: {
            paymentStatus: 'paid',
            orderStatus: 'processing',
            walletTransactionId: new mongoose.Types.ObjectId(spend.transactionId),
            walletPromoUsed: spend.promoUsed,
            walletAccountUsed: spend.accountUsed,
          },
        },
        { session },
      );

      const [checkout] = await CartCheckout.create(
        [
          {
            cartCheckoutId,
            userId: new mongoose.Types.ObjectId(userId),
            sellPriceUSD,
            displayCurrency,
            displayAmount,
            exchangeRateUsed: rate,
            paymentMethod: 'wallet',
            paymentStatus: 'paid',
            status: 'processing',
            walletTransactionId: new mongoose.Types.ObjectId(spend.transactionId),
            walletPromoUsed: spend.promoUsed,
            walletAccountUsed: spend.accountUsed,
            customerName,
            customerEmail,
            customerPhone,
            domainOrderIds,
            hostingOrderIds,
          },
        ],
        { session },
      );
      checkoutOid = checkout._id;
    });
  } finally {
    session.endSession();
  }

  if (!checkoutOid || !walletSpend) {
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to process wallet cart payment.');
  }
  const spent = walletSpend as WalletSpend;

  const domainOrders = await DomainOrder.find({ _id: { $in: domainOrderIds } });
  const hostingOrders = await HostingOrder.find({ _id: { $in: hostingOrderIds } });

  const lineResults: ICartLineResult[] = [];
  for (const order of domainOrders) {
    lineResults.push(await fulfillDomainLine(order));
  }
  for (const order of hostingOrders) {
    lineResults.push(await fulfillHostingLine(order));
  }

  const refundedResults = await refundFailedLines({
    lineResults,
    captureId: null,
    paymentMethod: 'wallet',
    userId,
    cartCheckoutId,
    walletPromoUsed: spent.promoUsed,
    walletAccountUsed: spent.accountUsed,
  });

  for (const line of refundedResults) {
    if (line.status === 'failed' && (line.refundedUSD || 0) > 0 && line.dbOrderId) {
      if (line.type === 'domain') {
        await DomainOrder.updateOne(
          { _id: line.dbOrderId },
          { $set: { paymentStatus: 'refunded', refundedAt: new Date() } },
        );
      } else {
        await HostingOrder.updateOne(
          { _id: line.dbOrderId },
          { $set: { paymentStatus: 'refunded', refundedAt: new Date() } },
        );
      }
    }
  }

  const summary = summarizeStatus(refundedResults);
  await CartCheckout.updateOne(
    { _id: checkoutOid },
    {
      $set: {
        status: summary.status,
        paymentStatus: summary.paymentStatus,
        lineResults: refundedResults,
      },
    },
  );

  const refreshed = await CartCheckout.findById(checkoutOid).lean();
  if (refreshed) {
    await sendCartEmails(refreshed as ICartCheckout, refundedResults);
  }

  // If everything failed after wallet debit, surface an error for the UI
  if (summary.status === 'failed') {
    const reasons = refundedResults
      .filter((r) => r.status === 'failed' && r.failureReason)
      .map((r) => `${r.label}: ${r.failureReason}`)
      .join(' | ');
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      reasons
        ? `Cart fulfillment failed. ${reasons}. Failed items were refunded to your wallet where possible.`
        : 'Cart fulfillment failed. Failed items were refunded to your wallet where possible.',
    );
  }

  return refreshed as ICartCheckout;
};
