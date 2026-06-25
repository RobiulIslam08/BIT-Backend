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

  // If a payment screenshot file was uploaded via multer, store the filename
  if (req.file) {
    orderData.paymentScreenshot = req.file.filename;
  }

  const result = await GmbOrderServices.submitGmbOrder(orderData);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'GMB order placed successfully.',
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
  validateCoupon,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  createPayPalOrder,
};
