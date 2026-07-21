// ============================================
// BIT SOFTWARE — Domain Pricing Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import * as DomainPricingService from './domainPricing.service';

const getPublicPricing = catchAsync(async (_req, res) => {
  const result = await DomainPricingService.getPublicPricing();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain pricing retrieved.',
    data: result,
  });
});

const getAllPricing = catchAsync(async (req, res) => {
  const result = await DomainPricingService.getAllPricing(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain pricing list retrieved.',
    data: result,
  });
});

const createPricing = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const result = await DomainPricingService.createPricing(adminId, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Domain pricing added.',
    data: result,
  });
});

const updatePricing = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const result = await DomainPricingService.updatePricing(
    req.params.id as string,
    adminId,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain pricing updated.',
    data: result,
  });
});

const deletePricing = catchAsync(async (req, res) => {
  const result = await DomainPricingService.deletePricing(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Pricing for .${result.tld} removed.`,
    data: result,
  });
});

const bulkUpsertPricing = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const result = await DomainPricingService.bulkUpsertPricing(adminId, req.body.items);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Updated ${result.upserted} TLD price(s).`,
    data: result,
  });
});

export const DomainPricingControllers = {
  getPublicPricing,
  getAllPricing,
  createPricing,
  updatePricing,
  deletePricing,
  bulkUpsertPricing,
};
