// ============================================
// BIT SOFTWARE — Business Email Asset Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import * as EmailService from './email.service';

const getMyEmails = catchAsync(async (req, res) => {
  const result = await EmailService.getMyEmails(req.user.userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Your Business Email subscriptions retrieved.',
    data: result,
  });
});

const getMyEmailById = catchAsync(async (req, res) => {
  const result = await EmailService.getMyEmailById(
    req.user.userId as string,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Business Email retrieved.',
    data: result,
  });
});

const sendWebmailAccess = catchAsync(async (req, res) => {
  const result = await EmailService.sendWebmailAccessEmail(
    req.user.userId as string,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Webmail access details sent to your email.',
    data: result,
  });
});

const searchUsers = catchAsync(async (req, res) => {
  const result = await EmailService.searchUsers(req.query.search as string | undefined);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Users retrieved.',
    data: result,
  });
});

const getAllEmails = catchAsync(async (req, res) => {
  const result = await EmailService.getAllEmails(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Email subscriptions retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
      totalRenewPriceUSD: result.meta.totalRenewPriceUSD,
    },
    data: result.emails,
  });
});

const createEmail = catchAsync(async (req, res) => {
  const result = await EmailService.createEmail(req.user.userId as string, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Business Email assigned.',
    data: result,
  });
});

const getEmailByIdAdmin = catchAsync(async (req, res) => {
  const result = await EmailService.getEmailByIdAdmin(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Business Email retrieved.',
    data: result,
  });
});

const updateEmail = catchAsync(async (req, res) => {
  const result = await EmailService.updateEmail(req.params.id as string, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Business Email updated.',
    data: result,
  });
});

const deleteEmail = catchAsync(async (req, res) => {
  const result = await EmailService.deleteEmail(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Business Email deleted.',
    data: result,
  });
});

export const EmailControllers = {
  getMyEmails,
  getMyEmailById,
  sendWebmailAccess,
  searchUsers,
  getAllEmails,
  createEmail,
  getEmailByIdAdmin,
  updateEmail,
  deleteEmail,
};
