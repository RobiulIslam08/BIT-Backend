// ============================================
// BIT SOFTWARE — Business Email Plan Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import * as EmailPlanService from './emailPlan.service';

const getPublicPlans = catchAsync(async (_req, res) => {
  const result = await EmailPlanService.getPublicPlans();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Email plans retrieved.',
    data: result,
  });
});

const getAllPlans = catchAsync(async (req, res) => {
  const result = await EmailPlanService.getAllPlansAdmin(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Email plans retrieved.',
    data: result,
  });
});

const createPlan = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const result = await EmailPlanService.createPlan(adminId, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Email plan created.',
    data: result,
  });
});

const updatePlan = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const result = await EmailPlanService.updatePlan(req.params.id as string, adminId, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Email plan updated.',
    data: result,
  });
});

const deletePlan = catchAsync(async (req, res) => {
  const result = await EmailPlanService.deletePlan(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Email plan deleted.',
    data: result,
  });
});

export const EmailPlanControllers = {
  getPublicPlans,
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
};
