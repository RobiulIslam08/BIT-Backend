// ============================================
// BIT SOFTWARE — Domain Order Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import * as DomainOrderService from './domainOrder.service';
import { TSupportedCurrency } from './domainOrder.interface';
import AppError from '../../errors/AppError';

const VALID_CURRENCIES: TSupportedCurrency[] = ['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'];

// ─── POST /api/v1/domain-orders/create-paypal-order ───
const createPayPalOrder = catchAsync(async (req, res) => {
  const { domainName, displayCurrency, customerName, customerEmail, customerPhone } = req.body;
  const userId = req.user.userId as string;

  if (!domainName) throw new AppError(httpStatus.BAD_REQUEST, 'domainName is required.');
  if (!customerName) throw new AppError(httpStatus.BAD_REQUEST, 'customerName is required.');
  if (!customerEmail) throw new AppError(httpStatus.BAD_REQUEST, 'customerEmail is required.');

  const currency: TSupportedCurrency = VALID_CURRENCIES.includes(displayCurrency)
    ? (displayCurrency as TSupportedCurrency)
    : 'SAR';

  const result = await DomainOrderService.createPayPalOrderForDomain({
    domainName,
    displayCurrency: currency,
    customerName,
    customerEmail,
    customerPhone,
    userId,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'PayPal order created. Proceed to payment.',
    data: result,
  });
});

// ─── POST /api/v1/domain-orders/complete-purchase ───
const completePurchase = catchAsync(async (req, res) => {
  const { paypalOrderId } = req.body;
  const userId = req.user.userId as string;

  if (!paypalOrderId) throw new AppError(httpStatus.BAD_REQUEST, 'paypalOrderId is required.');

  const result = await DomainOrderService.completeDomainPurchase({ paypalOrderId, userId });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: (result as any).orderStatus === 'active'
      ? `Domain "${(result as any).domainName}" successfully registered!`
      : 'Purchase processed.',
    data: result,
  });
});

// ─── GET /api/v1/domain-orders/my-domains ───
const getMyDomains = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await DomainOrderService.getUserDomains(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain list retrieved.',
    data: result,
  });
});

// ─── GET /api/v1/domain-orders/exchange-rates ───
const getExchangeRates = catchAsync(async (_req, res) => {
  const rates = await DomainOrderService.getPublicExchangeRates();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Exchange rates retrieved.',
    data: rates,
  });
});

// ─── GET /api/v1/domain-orders/:id ───
const getDomainOrderById = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user.role === 'admin' ? undefined : (req.user.userId as string);
  const result = await DomainOrderService.getDomainOrderById(id, userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain order retrieved.',
    data: result,
  });
});

// ─── GET /api/v1/domain-orders ─── (admin)
const getAllOrders = catchAsync(async (req, res) => {
  const result = await DomainOrderService.getAllDomainOrders(req.query as Record<string, unknown>);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'All domain orders retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
    },
    data: result.orders,
  });
});

// ─── PATCH /api/v1/domain-orders/:id ─── (admin)
const updateOrderStatus = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await DomainOrderService.updateDomainOrderStatus(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain order updated.',
    data: result,
  });
});

export const DomainOrderControllers = {
  createPayPalOrder,
  completePurchase,
  getMyDomains,
  getExchangeRates,
  getDomainOrderById,
  getAllOrders,
  updateOrderStatus,
};
