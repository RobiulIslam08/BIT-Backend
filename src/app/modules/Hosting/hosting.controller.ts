// ============================================
// BIT SOFTWARE — Hosting Asset Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import * as HostingService from './hosting.service';

// ─── ADMIN ───

const createHosting = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const result = await HostingService.createHosting(adminId, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Hosting assigned successfully.',
    data: result,
  });
});

const getAllHostings = catchAsync(async (req, res) => {
  const result = await HostingService.getAllHostings(req.query as Record<string, unknown>);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hostings retrieved.',
    meta: {
      page: result.meta.page,
      limit: result.meta.limit,
      total: result.meta.total,
      totalPage: result.meta.totalPages,
    },
    data: result.hostings,
  });
});

const getHostingByIdAdmin = catchAsync(async (req, res) => {
  const result = await HostingService.getHostingByIdAdmin(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting retrieved.',
    data: result,
  });
});

const updateHosting = catchAsync(async (req, res) => {
  const result = await HostingService.updateHosting(req.params.id as string, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting updated.',
    data: result,
  });
});

const deleteHosting = catchAsync(async (req, res) => {
  const result = await HostingService.deleteHosting(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting removed.',
    data: result,
  });
});

const searchUsers = catchAsync(async (req, res) => {
  const result = await HostingService.searchUsers(req.query.search as string | undefined);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Users retrieved.',
    data: result,
  });
});

const uploadProject = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const file = req.file as Express.Multer.File;
  const result = await HostingService.uploadProjectFile(req.params.id as string, adminId, file);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Project file uploaded.',
    data: result,
  });
});

const removeProject = catchAsync(async (req, res) => {
  const result = await HostingService.removeProjectFile(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Project file removed.',
    data: result,
  });
});

// ─── USER ───

const getMyHostings = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await HostingService.getUserHostings(userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting list retrieved.',
    data: result,
  });
});

const getMyHostingById = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const result = await HostingService.getUserHostingById(userId, req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hosting details retrieved.',
    data: result,
  });
});

const downloadMyProject = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const isAdmin = req.user.role === 'admin';
  const { absolutePath, downloadName } = await HostingService.getProjectDownloadPath(
    userId,
    req.params.id as string,
    isAdmin,
  );
  res.download(absolutePath, downloadName);
});

export const HostingControllers = {
  createHosting,
  getAllHostings,
  getHostingByIdAdmin,
  updateHosting,
  deleteHosting,
  searchUsers,
  uploadProject,
  removeProject,
  getMyHostings,
  getMyHostingById,
  downloadMyProject,
};
