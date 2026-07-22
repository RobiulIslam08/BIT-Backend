// ============================================
// BIT SOFTWARE — Hosting Plan Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import * as HostingPlanService from './hostingPlan.service';

const getPublicPlans = catchAsync(async (req, res) => {
  const planType = req.query.planType as string | undefined;
  const result = await HostingPlanService.getPublicPlans(planType);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting plans retrieved.',
    data: result,
  });
});

const getAllPlans = catchAsync(async (req, res) => {
  const result = await HostingPlanService.getAllPlansAdmin(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting plans retrieved.',
    data: result,
  });
});

const createPlan = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const result = await HostingPlanService.createPlan(adminId, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Hosting plan created.',
    data: result,
  });
});

const updatePlan = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const result = await HostingPlanService.updatePlan(req.params.id as string, adminId, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting plan updated.',
    data: result,
  });
});

const deletePlan = catchAsync(async (req, res) => {
  const result = await HostingPlanService.deletePlan(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting plan deleted.',
    data: result,
  });
});

export const HostingPlanControllers = {
  getPublicPlans,
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
};
