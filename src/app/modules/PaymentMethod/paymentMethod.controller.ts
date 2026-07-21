// ============================================
// BIT SOFTWARE — Payment Method Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import * as PaymentMethodService from './paymentMethod.service';

// ─── POST /payment-methods/setup-token ───
const createSetupToken = catchAsync(async (_req, res) => {
  const result = await PaymentMethodService.createSetupToken();
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Setup token created.',
    data: result,
  });
});

// ─── POST /payment-methods ───
const savePaymentMethod = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const setupToken = req.body.setupToken || req.body.vaultSetupToken;
  const result = await PaymentMethodService.savePaymentMethod(userId, setupToken);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Payment method saved successfully.',
    data: result,
  });
});

// ─── GET /payment-methods ───
const getMyPaymentMethods = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await PaymentMethodService.getUserPaymentMethods(userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Payment methods retrieved.',
    data: result,
  });
});

// ─── PATCH /payment-methods/:id/default ───
const setDefault = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await PaymentMethodService.setDefaultPaymentMethod(userId, req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Default payment method updated.',
    data: result,
  });
});

// ─── DELETE /payment-methods/:id ───
const deletePaymentMethod = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await PaymentMethodService.deletePaymentMethod(userId, req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Payment method removed.',
    data: result,
  });
});

export const PaymentMethodControllers = {
  createSetupToken,
  savePaymentMethod,
  getMyPaymentMethods,
  setDefault,
  deletePaymentMethod,
};
