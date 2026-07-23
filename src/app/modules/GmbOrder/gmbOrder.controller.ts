// ============================================
// BIT SOFTWARE — GMB Order Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { GmbOrderServices } from './gmbOrder.service';

// ==================== SUBMIT ORDER ====================
const submitOrder = catchAsync(async (req, res) => {
  const orderData = req.body;

  // Wallet payments must go through the authenticated /pay-with-wallet route.
  // Never accept paymentMethod=wallet on the public submit endpoint.
  if (orderData?.paymentMethod === 'wallet') {
    return res.status(400).json({
      success: false,
      message: 'Please use the wallet checkout endpoint while logged in.',
    });
  }

  // If a payment screenshot was uploaded via multer memoryStorage,
  // convert the buffer to a base64 data URI for MongoDB storage.
  // (Vercel serverless filesystem is read-only — no disk writes allowed)
  if (req.file) {
    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    orderData.paymentScreenshot = `data:${mimeType};base64,${base64}`;
  }

  const result = await GmbOrderServices.submitGmbOrder(orderData);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'GMB order placed successfully.',
    data: result,
  });
});

// ==================== PAY WITH WALLET (Authenticated) ====================
const payWithWallet = catchAsync(async (req, res) => {
  const orderData = { ...req.body, paymentMethod: 'wallet', userId: req.user.userId };

  const result = await GmbOrderServices.submitGmbOrder(orderData);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'GMB order placed successfully (paid from wallet).',
    data: result,
  });
});

// ==================== VALIDATE COUPON ====================
const validateCoupon = catchAsync(async (req, res) => {
  const { couponCode } = req.body;
  const result = await GmbOrderServices.validateCoupon(couponCode);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Coupon is valid.',
    data: result,
  });
});

// ==================== GET ORDER BY ID ====================
const getOrderById = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await GmbOrderServices.getOrderById(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Order retrieved successfully.',
    data: result,
  });
});

// ==================== GET ALL ORDERS (Admin) ====================
const getAllOrders = catchAsync(async (req, res) => {
  const result = await GmbOrderServices.getAllOrders(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Orders retrieved successfully.',
    meta: result.meta,
    data: result.orders,
  });
});

// ==================== UPDATE ORDER STATUS (Admin) ====================
const updateOrderStatus = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await GmbOrderServices.updateOrderStatus(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Order status updated successfully.',
    data: result,
  });
});

// ==================== UPDATE ORDER INFO (Admin) ====================
const updateOrderInfo = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await GmbOrderServices.updateOrderInfo(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Order info updated successfully.',
    data: result,
  });
});

// ==================== DELETE ORDER (Admin) ====================
const deleteOrder = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await GmbOrderServices.deleteOrder(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Order deleted successfully.',
    data: result,
  });
});

// ==================== CREATE PAYPAL ORDER (Server-Side) ====================
const createPayPalOrder = catchAsync(async (req, res) => {
  const { finalAmount, serviceType } = req.body;
  const result = await GmbOrderServices.createPayPalOrderForCheckout({ finalAmount, serviceType });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'PayPal order created successfully.',
    data: result,
  });
});

export const GmbOrderControllers = {
  submitOrder,
  payWithWallet,
  validateCoupon,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  updateOrderInfo,
  deleteOrder,
  createPayPalOrder,
};
