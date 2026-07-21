// ============================================
// BIT SOFTWARE — Domain Asset Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import * as DomainService from './domainAsset.service';
import { TSupportedCurrency } from '../DomainOrder/domainOrder.interface';

const VALID_CURRENCIES: TSupportedCurrency[] = ['SAR', 'USD', 'EUR', 'CAD', 'BDT', 'PKR', 'INR'];

// ============================================
// ADMIN
// ============================================

const createDomain = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const result = await DomainService.createDomain(adminId, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Domain added successfully.',
    data: result,
  });
});

const getAllDomains = catchAsync(async (req, res) => {
  const result = await DomainService.getAllDomains(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domains retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
    },
    data: result.domains,
  });
});

const getDomainByIdAdmin = catchAsync(async (req, res) => {
  const result = await DomainService.getDomainByIdAdmin(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain retrieved.',
    data: result,
  });
});

const updateDomain = catchAsync(async (req, res) => {
  const result = await DomainService.updateDomain(req.params.id as string, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain updated.',
    data: result,
  });
});

const deleteDomain = catchAsync(async (req, res) => {
  const result = await DomainService.deleteDomain(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain removed.',
    data: result,
  });
});

const searchUsers = catchAsync(async (req, res) => {
  const result = await DomainService.searchUsers(req.query.search as string | undefined);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Users retrieved.',
    data: result,
  });
});

// ============================================
// USER
// ============================================

const getMyDomains = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await DomainService.getUserDomains(userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain list retrieved.',
    data: result,
  });
});

const getMyDomainById = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await DomainService.getUserDomainById(userId, req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain details retrieved.',
    data: result,
  });
});

const toggleAutoRenew = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const { autoRenew } = req.body;
  const result = await DomainService.toggleAutoRenew(userId, req.params.id as string, autoRenew);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.needsPaymentMethod
      ? 'Auto-renew enabled. Add a saved payment method to allow automatic charges.'
      : `Auto-renew ${autoRenew ? 'enabled' : 'disabled'}.`,
    data: result,
  });
});

const createRenewOrder = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const { displayCurrency } = req.body;
  const currency: TSupportedCurrency = VALID_CURRENCIES.includes(displayCurrency)
    ? displayCurrency
    : 'SAR';

  const result = await DomainService.createRenewOrder({
    userId,
    domainId: req.params.id as string,
    displayCurrency: currency,
  });
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Renewal order created. Proceed to payment.',
    data: result,
  });
});

const completeRenew = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const { paypalOrderId } = req.body;
  if (!paypalOrderId) throw new AppError(httpStatus.BAD_REQUEST, 'paypalOrderId is required.');

  const result = await DomainService.completeRenew({ userId, paypalOrderId });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain renewed successfully.',
    data: result,
  });
});

// ============================================
// SYSTEM — Auto-renew engine
// ============================================

// Admin-triggered run.
const runRenewalEngineAdmin = catchAsync(async (_req, res) => {
  const summary = await DomainService.runRenewalEngine();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Renewal engine executed.',
    data: summary,
  });
});

// Cron-triggered run (protected by a shared secret, no user session).
// Accepts either `x-cron-secret: <secret>` or `Authorization: Bearer <secret>`
// (the latter is what Vercel Cron sends automatically when CRON_SECRET is set).
const runRenewalEngineCron = catchAsync(async (req, res) => {
  const expected = process.env.CRON_SECRET;
  const headerSecret = req.headers['x-cron-secret'];
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : undefined;

  if (!expected || (headerSecret !== expected && bearer !== expected)) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Invalid cron secret.');
  }
  const summary = await DomainService.runRenewalEngine();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Renewal engine executed.',
    data: summary,
  });
});

export const DomainControllers = {
  // admin
  createDomain,
  getAllDomains,
  getDomainByIdAdmin,
  updateDomain,
  deleteDomain,
  searchUsers,
  runRenewalEngineAdmin,
  // user
  getMyDomains,
  getMyDomainById,
  toggleAutoRenew,
  createRenewOrder,
  completeRenew,
  // cron
  runRenewalEngineCron,
};
