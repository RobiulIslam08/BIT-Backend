// ============================================
// BIT SOFTWARE — GMB Profile Asset Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import * as GmbProfileService from './gmbProfile.service';

// ─── ADMIN ───

const createGmbProfile = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const result = await GmbProfileService.createGmbProfile(adminId, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'GMB profile assigned successfully.',
    data: result,
  });
});

const getAllGmbProfiles = catchAsync(async (req, res) => {
  const result = await GmbProfileService.getAllGmbProfiles(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'GMB profiles retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
    },
    data: result.profiles,
  });
});

const getGmbProfileByIdAdmin = catchAsync(async (req, res) => {
  const result = await GmbProfileService.getGmbProfileByIdAdmin(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'GMB profile retrieved.',
    data: result,
  });
});

const updateGmbProfile = catchAsync(async (req, res) => {
  const result = await GmbProfileService.updateGmbProfile(req.params.id as string, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'GMB profile updated.',
    data: result,
  });
});

const deleteGmbProfile = catchAsync(async (req, res) => {
  const result = await GmbProfileService.deleteGmbProfile(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'GMB profile removed.',
    data: result,
  });
});

const searchUsers = catchAsync(async (req, res) => {
  const result = await GmbProfileService.searchUsers(req.query.search as string | undefined);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Users retrieved.',
    data: result,
  });
});

// ─── USER ───

const getMyGmbProfiles = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await GmbProfileService.getUserGmbProfiles(userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Your GMB profiles retrieved.',
    data: result,
  });
});

const getMyGmbProfileById = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await GmbProfileService.getUserGmbProfileById(userId, req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'GMB profile retrieved.',
    data: result,
  });
});

export const GmbProfileControllers = {
  createGmbProfile,
  getAllGmbProfiles,
  getGmbProfileByIdAdmin,
  updateGmbProfile,
  deleteGmbProfile,
  searchUsers,
  getMyGmbProfiles,
  getMyGmbProfileById,
};
