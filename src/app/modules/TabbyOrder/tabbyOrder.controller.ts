// ============================================
// BIT SOFTWARE — Tabby Business Order Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import { TabbyOrderServices } from './tabbyOrder.service';
import { TTabbyFileKey } from './tabbyOrder.interface';

const createPayPalOrder = catchAsync(async (_req, res) => {
  const result = await TabbyOrderServices.createPayPalOrderForCheckout();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'PayPal order created successfully.',
    data: result,
  });
});

const submitOrder = catchAsync(async (req, res) => {
  const userId = req.user?.userId as string;
  const result = await TabbyOrderServices.submitPaypalOrder(req.body || {}, userId, []);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Tabby order placed successfully. Setup will be completed within 3 working days.',
    data: result,
  });
});

const payWithWallet = catchAsync(async (req, res) => {
  const userId = req.user?.userId as string;
  const result = await TabbyOrderServices.submitWalletOrder(req.body || {}, userId, []);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Tabby order placed successfully (paid from wallet). Setup will be completed within 3 working days.',
    data: result,
  });
});

const getMyOrders = catchAsync(async (req, res) => {
  const result = await TabbyOrderServices.getMyOrders(req.user.userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Tabby orders retrieved successfully.',
    data: result,
  });
});

const getMyOrderById = catchAsync(async (req, res) => {
  const result = await TabbyOrderServices.getMyOrderById(req.user.userId as string, req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Tabby order retrieved successfully.',
    data: result,
  });
});

const requestRefund = catchAsync(async (req, res) => {
  const result = await TabbyOrderServices.requestRefund(
    req.user.userId as string,
    req.params.id as string,
    req.body?.reason,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Refund request submitted. Our team will review it shortly.',
    data: result,
  });
});

const getAllOrders = catchAsync(async (req, res) => {
  const result = await TabbyOrderServices.getAllOrders(req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Tabby orders retrieved successfully.',
    meta: result.meta,
    data: { orders: result.orders, stats: result.stats },
  });
});

const updateOrder = catchAsync(async (req, res) => {
  const result = await TabbyOrderServices.updateOrder(req.params.id as string, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Order updated successfully.',
    data: result,
  });
});

const processRefund = catchAsync(async (req, res) => {
  const action = req.body?.action === 'reject' ? 'reject' : 'approve';
  const result = await TabbyOrderServices.processRefund(
    req.params.id as string,
    action,
    req.body?.adminNote || req.body?.reason,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: action === 'reject' ? 'Refund request rejected.' : 'Refund processed successfully.',
    data: result,
  });
});

const uploadFile = catchAsync(async (req, res) => {
  const uploaded = req.file as Express.Multer.File | undefined;
  if (!uploaded?.buffer) {
    throw new AppError(httpStatus.BAD_REQUEST, 'A file is required.');
  }
  const key = String(req.body?.key || '');
  const result = await TabbyOrderServices.uploadOrderFile({
    orderId: req.params.id as string,
    userId: req.user.userId as string,
    role: req.user.role as string,
    key,
    file: {
      key: key as TTabbyFileKey,
      originalName: uploaded.originalname || `${key}.bin`,
      mimeType: uploaded.mimetype,
      size: uploaded.size,
      data: uploaded.buffer.toString('base64'),
    },
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Document uploaded successfully.',
    data: result,
  });
});

const downloadFile = catchAsync(async (req, res) => {
  const file = await TabbyOrderServices.getFileForDownload({
    orderId: req.params.id as string,
    fileId: req.params.fileId as string,
    userId: req.user.userId as string,
    role: req.user.role as string,
  });
  const buffer = Buffer.from(file.data, 'base64');
  const safeName = (file.originalName || file.key).replace(/[^\w.\-]+/g, '_');
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.send(buffer);
});

const deleteOrder = catchAsync(async (req, res) => {
  const result = await TabbyOrderServices.deleteOrder(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Order deleted successfully.',
    data: result,
  });
});

export const TabbyOrderControllers = {
  createPayPalOrder,
  submitOrder,
  payWithWallet,
  getMyOrders,
  getMyOrderById,
  requestRefund,
  getAllOrders,
  updateOrder,
  processRefund,
  uploadFile,
  downloadFile,
  deleteOrder,
};
