// ============================================
// BIT SOFTWARE — Wallet Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { WalletService } from './wallet.service';

// ─── Customer ───
const getSummary = catchAsync(async (req, res) => {
  const result = await WalletService.getWalletSummary(req.user.userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Wallet summary retrieved.',
    data: result,
  });
});

const getTransactions = catchAsync(async (req, res) => {
  const result = await WalletService.getMyTransactions(
    req.user.userId as string,
    req.query as Record<string, unknown>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Wallet transactions retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
    },
    data: result.items,
  });
});

const createTopupOrder = catchAsync(async (req, res) => {
  const result = await WalletService.createTopupPayPalOrder({
    userId: req.user.userId as string,
    amountUSD: Number(req.body.amountUSD),
  });
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Top-up PayPal order created. Proceed to payment.',
    data: result,
  });
});

const completeTopup = catchAsync(async (req, res) => {
  const result = await WalletService.completeTopup({
    userId: req.user.userId as string,
    paypalOrderId: String(req.body.paypalOrderId),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.alreadyProcessed
      ? 'Top-up already processed.'
      : 'Wallet topped up successfully.',
    data: result,
  });
});

const createWithdrawal = catchAsync(async (req, res) => {
  const result = await WalletService.requestWithdrawal({
    userId: req.user.userId as string,
    amountUSD: Number(req.body.amountUSD),
    method: req.body.method,
    details: req.body.details || {},
  });
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Withdrawal request submitted. It is now pending admin approval.',
    data: result,
  });
});

const getMyWithdrawals = catchAsync(async (req, res) => {
  const result = await WalletService.getMyWithdrawals(
    req.user.userId as string,
    req.query as Record<string, unknown>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Withdrawal requests retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
    },
    data: result.items,
  });
});

// ─── Admin ───
const getSettings = catchAsync(async (_req, res) => {
  const result = await WalletService.getSettings();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Wallet settings retrieved.',
    data: result,
  });
});

const updateSettings = catchAsync(async (req, res) => {
  const result = await WalletService.updateSettings(req.body, req.user.userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Wallet settings updated.',
    data: result,
  });
});

const grantCredit = catchAsync(async (req, res) => {
  const result = await WalletService.grantCredit({
    target: req.body.target,
    userId: req.body.userId,
    userIds: req.body.userIds,
    amountUSD: Number(req.body.amountUSD),
    note: req.body.note,
    adminId: req.user.userId as string,
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Promotional credit granted to ${result.granted} user(s).`,
    data: result,
  });
});

const adjustBalance = catchAsync(async (req, res) => {
  const result = await WalletService.adjustBalance({
    userId: req.body.userId,
    accountDelta: req.body.accountDelta,
    promoDelta: req.body.promoDelta,
    note: req.body.note,
    adminId: req.user.userId as string,
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Balance adjusted.',
    data: result,
  });
});

const listWithdrawals = catchAsync(async (req, res) => {
  const result = await WalletService.listWithdrawals(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Withdrawal requests retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
    },
    data: result.items,
  });
});

const processWithdrawal = catchAsync(async (req, res) => {
  const result = await WalletService.processWithdrawal({
    withdrawalId: req.params.id as string,
    action: req.body.action,
    payoutRef: req.body.payoutRef,
    adminNote: req.body.adminNote,
    adminId: req.user.userId as string,
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Withdrawal ${req.body.action === 'complete' ? 'completed' : 'rejected'}.`,
    data: result,
  });
});

const getUserTransactions = catchAsync(async (req, res) => {
  const result = await WalletService.getUserTransactions(
    req.params.id as string,
    req.query as Record<string, unknown>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'User wallet transactions retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
    },
    data: result.items,
  });
});

export const WalletControllers = {
  getSummary,
  getTransactions,
  createTopupOrder,
  completeTopup,
  createWithdrawal,
  getMyWithdrawals,
  getSettings,
  updateSettings,
  grantCredit,
  adjustBalance,
  listWithdrawals,
  processWithdrawal,
  getUserTransactions,
};
