// ============================================
// BIT SOFTWARE — Hosting Order Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import * as HostingOrderService from './hostingOrder.service';
import { THostingBillingCycle, TSupportedCurrency } from './hostingOrder.interface';

const VALID_CURRENCIES: TSupportedCurrency[] = ['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'];

const createPayPalOrder = catchAsync(async (req, res) => {
  const {
    planSlug,
    billingCycle,
    displayCurrency,
    customerName,
    customerEmail,
    customerPhone,
    websiteLabel,
  } = req.body;
  const userId = req.user.userId as string;

  if (!planSlug) throw new AppError(httpStatus.BAD_REQUEST, 'planSlug is required.');
  if (!customerName) throw new AppError(httpStatus.BAD_REQUEST, 'customerName is required.');
  if (!customerEmail) throw new AppError(httpStatus.BAD_REQUEST, 'customerEmail is required.');

  if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
    throw new AppError(httpStatus.BAD_REQUEST, 'billingCycle must be "monthly" or "yearly".');
  }
  const cycle: THostingBillingCycle = billingCycle;

  const currency: TSupportedCurrency = VALID_CURRENCIES.includes(displayCurrency)
    ? (displayCurrency as TSupportedCurrency)
    : 'SAR';

  const result = await HostingOrderService.createPayPalOrderForHosting({
    planSlug,
    billingCycle: cycle,
    displayCurrency: currency,
    customerName,
    customerEmail,
    customerPhone,
    websiteLabel,
    userId,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'PayPal order created. Proceed to payment.',
    data: result,
  });
});

const completePurchase = catchAsync(async (req, res) => {
  const { paypalOrderId } = req.body;
  const userId = req.user.userId as string;

  if (!paypalOrderId) throw new AppError(httpStatus.BAD_REQUEST, 'paypalOrderId is required.');

  const result = await HostingOrderService.completeHostingPurchase({ paypalOrderId, userId });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      (result as any).orderStatus === 'active'
        ? `Hosting plan "${(result as any).planName}" activated successfully!`
        : 'Purchase processed.',
    data: result,
  });
});

const payWithWallet = catchAsync(async (req, res) => {
  const {
    planSlug,
    billingCycle,
    displayCurrency,
    customerName,
    customerEmail,
    customerPhone,
    websiteLabel,
  } = req.body;
  const userId = req.user.userId as string;

  if (!planSlug) throw new AppError(httpStatus.BAD_REQUEST, 'planSlug is required.');
  if (!customerName) throw new AppError(httpStatus.BAD_REQUEST, 'customerName is required.');
  if (!customerEmail) throw new AppError(httpStatus.BAD_REQUEST, 'customerEmail is required.');

  if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
    throw new AppError(httpStatus.BAD_REQUEST, 'billingCycle must be "monthly" or "yearly".');
  }
  const cycle: THostingBillingCycle = billingCycle;
  const currency: TSupportedCurrency = VALID_CURRENCIES.includes(displayCurrency)
    ? (displayCurrency as TSupportedCurrency)
    : 'SAR';

  const result = await HostingOrderService.payForHostingWithWallet({
    planSlug,
    billingCycle: cycle,
    displayCurrency: currency,
    customerName,
    customerEmail,
    customerPhone,
    websiteLabel,
    userId,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: `Hosting plan "${(result as any).planName}" activated successfully!`,
    data: result,
  });
});

const getMyOrders = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await HostingOrderService.getUserHostingOrders(userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting orders retrieved.',
    data: result,
  });
});

const getExchangeRates = catchAsync(async (_req, res) => {
  const rates = await HostingOrderService.getPublicExchangeRates();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Exchange rates retrieved.',
    data: rates,
  });
});

const getOrderById = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user.role === 'admin' ? undefined : (req.user.userId as string);
  const result = await HostingOrderService.getHostingOrderById(id, userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting order retrieved.',
    data: result,
  });
});

const getAllOrders = catchAsync(async (req, res) => {
  const result = await HostingOrderService.getAllHostingOrders(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting orders retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
    },
    data: result.orders,
  });
});

const updateOrderStatus = catchAsync(async (req, res) => {
  const result = await HostingOrderService.updateHostingOrderStatus(
    req.params.id as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting order updated.',
    data: result,
  });
});

export const HostingOrderControllers = {
  createPayPalOrder,
  completePurchase,
  payWithWallet,
  getMyOrders,
  getExchangeRates,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
};
