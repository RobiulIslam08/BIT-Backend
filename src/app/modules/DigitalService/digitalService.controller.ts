// ============================================
// BIT SOFTWARE — Digital Service Asset Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
import * as DigitalServiceService from './digitalService.service';
import { DIGITAL_SERVICE_KEYS } from './digitalService.catalog';

const getCatalog = catchAsync(async (_req, res) => {
  const data = DigitalServiceService.getCatalog();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Digital service catalog retrieved.',
    data,
  });
});

const getTrialEligibility = catchAsync(async (req, res) => {
  const serviceKey = String(req.query.serviceKey || 'supply_company_portal');
  if (!DIGITAL_SERVICE_KEYS.includes(serviceKey as any)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid serviceKey.');
  }
  const userId = req.user.userId as string;
  const data = await DigitalServiceService.getTrialEligibility(userId, serviceKey);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Trial eligibility retrieved.',
    data,
  });
});

const getMyServices = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const data = await DigitalServiceService.getUserDigitalServices(userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Services retrieved.',
    data,
  });
});

const getMyServiceById = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const data = await DigitalServiceService.getUserDigitalServiceById(
    userId,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Service retrieved.',
    data,
  });
});

const getAllServices = catchAsync(async (req, res) => {
  const result = await DigitalServiceService.getAllDigitalServices(
    req.query as Record<string, unknown>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Services retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
    },
    data: result.services,
  });
});

const getServiceByIdAdmin = catchAsync(async (req, res) => {
  const data = await DigitalServiceService.getDigitalServiceByIdAdmin(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Service retrieved.',
    data,
  });
});

const updateService = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const data = await DigitalServiceService.updateDigitalServiceAdmin(
    req.params.id as string,
    req.body,
    adminId,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Service updated.',
    data,
  });
});

export const DigitalServiceControllers = {
  getCatalog,
  getTrialEligibility,
  getMyServices,
  getMyServiceById,
  getAllServices,
  getServiceByIdAdmin,
  updateService,
};
