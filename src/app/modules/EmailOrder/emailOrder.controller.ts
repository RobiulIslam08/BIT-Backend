// ============================================
// BIT SOFTWARE — Business Email Order Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import * as EmailOrderService from './emailOrder.service';
import {
  TDomainOwnership,
  TEmailBillingCycle,
  TSupportedCurrency,
} from './emailOrder.interface';

const VALID_CURRENCIES: TSupportedCurrency[] = ['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'];

const pickIntake = (body: Record<string, any>) => ({
  businessName: body.businessName,
  country: body.country,
  teamSize: body.teamSize,
  domainName: body.domainName,
  domainOwnership: body.domainOwnership as TDomainOwnership | undefined,
  adminFirstName: body.adminFirstName,
  adminLastName: body.adminLastName,
  desiredEmailLocalPart: body.desiredEmailLocalPart,
  recoveryEmail: body.recoveryEmail,
  businessAddress: body.businessAddress,
});

const assertPurchaseBody = (body: Record<string, any>) => {
  if (!body.planSlug) throw new AppError(httpStatus.BAD_REQUEST, 'planSlug is required.');
  if (!body.customerName) throw new AppError(httpStatus.BAD_REQUEST, 'customerName is required.');
  if (!body.customerEmail) throw new AppError(httpStatus.BAD_REQUEST, 'customerEmail is required.');
  if (!body.customerPhone) throw new AppError(httpStatus.BAD_REQUEST, 'customerPhone is required.');
  if (!body.businessName) throw new AppError(httpStatus.BAD_REQUEST, 'businessName is required.');
  if (!body.country) throw new AppError(httpStatus.BAD_REQUEST, 'country is required.');
  if (!body.domainName) throw new AppError(httpStatus.BAD_REQUEST, 'domainName is required.');
  if (!body.adminFirstName) throw new AppError(httpStatus.BAD_REQUEST, 'adminFirstName is required.');
  if (!body.adminLastName) throw new AppError(httpStatus.BAD_REQUEST, 'adminLastName is required.');
  if (!body.desiredEmailLocalPart) {
    throw new AppError(httpStatus.BAD_REQUEST, 'desiredEmailLocalPart is required.');
  }
  if (!body.recoveryEmail) throw new AppError(httpStatus.BAD_REQUEST, 'recoveryEmail is required.');
  if (body.billingCycle !== 'monthly' && body.billingCycle !== 'yearly') {
    throw new AppError(httpStatus.BAD_REQUEST, 'billingCycle must be "monthly" or "yearly".');
  }
  if (body.termsAccepted !== true && body.termsAccepted !== 'true') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Please accept the Terms of Service to continue.');
  }
};

const pickIdempotencyKey = (req: { body?: Record<string, any>; headers?: Record<string, unknown> }) =>
  String(req.body?.idempotencyKey || req.headers?.['idempotency-key'] || '').trim();

const createPayPalOrder = catchAsync(async (req, res) => {
  assertPurchaseBody(req.body);
  const userId = req.user.userId as string;
  const currency: TSupportedCurrency = VALID_CURRENCIES.includes(req.body.displayCurrency)
    ? (req.body.displayCurrency as TSupportedCurrency)
    : 'SAR';

  const result = await EmailOrderService.createPayPalOrderForEmail({
    planSlug: req.body.planSlug,
    billingCycle: req.body.billingCycle as TEmailBillingCycle,
    displayCurrency: currency,
    customerName: req.body.customerName,
    customerEmail: req.body.customerEmail,
    customerPhone: req.body.customerPhone,
    userId,
    idempotencyKey: pickIdempotencyKey(req),
    termsAccepted: req.body.termsAccepted === true || req.body.termsAccepted === 'true',
    ...pickIntake(req.body),
  });

  sendResponse(res, {
    statusCode: result.alreadyPaid ? httpStatus.OK : httpStatus.CREATED,
    success: true,
    message: result.alreadyPaid
      ? 'This checkout was already paid. Mailbox setup has started.'
      : 'PayPal order created. Proceed to payment.',
    data: result,
  });
});

const completePurchase = catchAsync(async (req, res) => {
  const { paypalOrderId } = req.body;
  const userId = req.user.userId as string;
  if (!paypalOrderId) throw new AppError(httpStatus.BAD_REQUEST, 'paypalOrderId is required.');

  const result = await EmailOrderService.completeEmailPurchase({ paypalOrderId, userId });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      (result as any).orderStatus === 'active'
        ? `Payment confirmed for "${(result as any).planName}". Mailbox setup has started.`
        : 'Purchase processed.',
    data: result,
  });
});

const payWithWallet = catchAsync(async (req, res) => {
  assertPurchaseBody(req.body);
  const userId = req.user.userId as string;
  const currency: TSupportedCurrency = VALID_CURRENCIES.includes(req.body.displayCurrency)
    ? (req.body.displayCurrency as TSupportedCurrency)
    : 'SAR';

  const result = await EmailOrderService.payForEmailWithWallet({
    planSlug: req.body.planSlug,
    billingCycle: req.body.billingCycle as TEmailBillingCycle,
    displayCurrency: currency,
    customerName: req.body.customerName,
    customerEmail: req.body.customerEmail,
    customerPhone: req.body.customerPhone,
    userId,
    idempotencyKey: pickIdempotencyKey(req),
    termsAccepted: req.body.termsAccepted === true || req.body.termsAccepted === 'true',
    ...pickIntake(req.body),
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: `Payment confirmed for "${(result as any).planName}". Mailbox setup has started.`,
    data: result,
  });
});

const getMyOrders = catchAsync(async (req, res) => {
  const result = await EmailOrderService.getUserEmailOrders(req.user.userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Email orders retrieved.',
    data: result,
  });
});

const getExchangeRates = catchAsync(async (_req, res) => {
  const rates = await EmailOrderService.getPublicExchangeRates();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Exchange rates retrieved.',
    data: rates,
  });
});

const getOrderById = catchAsync(async (req, res) => {
  const userId = req.user.role === 'admin' ? undefined : (req.user.userId as string);
  const result = await EmailOrderService.getEmailOrderById(req.params.id as string, userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Email order retrieved.',
    data: result,
  });
});

const getAllOrders = catchAsync(async (req, res) => {
  const result = await EmailOrderService.getAllEmailOrders(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Email orders retrieved.',
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
  const result = await EmailOrderService.updateEmailOrderStatus(
    req.params.id as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Email order updated.',
    data: result,
  });
});

export const EmailOrderControllers = {
  createPayPalOrder,
  completePurchase,
  payWithWallet,
  getMyOrders,
  getExchangeRates,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
};
