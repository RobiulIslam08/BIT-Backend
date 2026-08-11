// ============================================
// BIT SOFTWARE — Digital Service Order Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import * as DigitalServiceOrderService from './digitalServiceOrder.service';
import { DIGITAL_PACKAGE_TYPES, DIGITAL_SERVICE_KEYS } from '../DigitalService/digitalService.catalog';

const createPayPalOrder = catchAsync(async (req, res) => {
  const { serviceKey, packageType, customerName, customerEmail, customerPhone } = req.body;
  const userId = req.user.userId as string;

  if (!serviceKey || !DIGITAL_SERVICE_KEYS.includes(serviceKey)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Valid serviceKey is required.');
  }
  if (!packageType || !DIGITAL_PACKAGE_TYPES.includes(packageType)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'packageType must be trial, monthly, or yearly.');
  }
  if (!customerName) throw new AppError(httpStatus.BAD_REQUEST, 'customerName is required.');
  if (!customerEmail) throw new AppError(httpStatus.BAD_REQUEST, 'customerEmail is required.');

  const result = await DigitalServiceOrderService.createPayPalOrderForDigitalService({
    serviceKey,
    packageType,
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

const completePurchase = catchAsync(async (req, res) => {
  const { paypalOrderId } = req.body;
  const userId = req.user.userId as string;

  if (!paypalOrderId) throw new AppError(httpStatus.BAD_REQUEST, 'paypalOrderId is required.');

  const result = await DigitalServiceOrderService.completeDigitalServicePurchase({
    paypalOrderId,
    userId,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      (result as any).orderStatus === 'active'
        ? `${(result as any).serviceName} activated successfully!`
        : 'Purchase processed.',
    data: result,
  });
});

const payWithWallet = catchAsync(async (req, res) => {
  const { serviceKey, packageType, customerName, customerEmail, customerPhone } = req.body;
  const userId = req.user.userId as string;

  if (!serviceKey || !DIGITAL_SERVICE_KEYS.includes(serviceKey)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Valid serviceKey is required.');
  }
  if (!packageType || !DIGITAL_PACKAGE_TYPES.includes(packageType)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'packageType must be trial, monthly, or yearly.');
  }
  if (!customerName) throw new AppError(httpStatus.BAD_REQUEST, 'customerName is required.');
  if (!customerEmail) throw new AppError(httpStatus.BAD_REQUEST, 'customerEmail is required.');

  const result = await DigitalServiceOrderService.payForDigitalServiceWithWallet({
    serviceKey,
    packageType,
    customerName,
    customerEmail,
    customerPhone,
    userId,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: `${(result as any).serviceName} activated successfully!`,
    data: result,
  });
});

const getMyOrders = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await DigitalServiceOrderService.getUserDigitalServiceOrders(userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Orders retrieved.',
    data: result,
  });
});

const getOrderById = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user.role === 'admin' ? undefined : (req.user.userId as string);
  const result = await DigitalServiceOrderService.getDigitalServiceOrderById(id, userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Order retrieved.',
    data: result,
  });
});

const getAllOrders = catchAsync(async (req, res) => {
  const result = await DigitalServiceOrderService.getAllDigitalServiceOrders(
    req.query as Record<string, unknown>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Orders retrieved.',
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
  const result = await DigitalServiceOrderService.updateDigitalServiceOrderStatus(
    req.params.id as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Order updated.',
    data: result,
  });
});

export const DigitalServiceOrderControllers = {
  createPayPalOrder,
  completePurchase,
  payWithWallet,
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
};
