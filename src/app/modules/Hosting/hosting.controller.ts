// ============================================
// BIT SOFTWARE — Hosting Asset Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import AppError from '../../errors/AppError';
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

const uploadProjectChunk = catchAsync(async (req, res) => {
  const file = req.file as Express.Multer.File;
  const chunkIndex = parseInt(String(req.body.chunkIndex), 10);
  const totalChunks = parseInt(String(req.body.totalChunks), 10);
  const uploadId = String(req.body.uploadId || '');

  const result = await HostingService.saveProjectChunk({
    hostingId: req.params.id as string,
    uploadId,
    chunkIndex,
    totalChunks,
    file,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Chunk ${chunkIndex + 1}/${totalChunks} received.`,
    data: result,
  });
});

const completeProjectChunks = catchAsync(async (req, res) => {
  const adminId = req.user.userId as string;
  const { uploadId, totalChunks, originalName, mimeType, totalSize } = req.body;

  const result = await HostingService.completeChunkedProjectUpload({
    hostingId: req.params.id as string,
    adminId,
    uploadId: String(uploadId || ''),
    totalChunks: parseInt(String(totalChunks), 10),
    originalName: String(originalName || ''),
    mimeType: mimeType ? String(mimeType) : undefined,
    totalSize: totalSize !== undefined ? Number(totalSize) : undefined,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Project file uploaded.',
    data: result,
  });
});

const abortProjectChunks = catchAsync(async (req, res) => {
  const uploadId = String(req.body.uploadId || req.query.uploadId || '');
  const result = await HostingService.abortChunkedProjectUpload(uploadId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Upload aborted.',
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
  // Stream from disk — do not load entire ZIP into memory
  res.download(absolutePath, downloadName);
});

const createDownloadToken = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const isAdmin = req.user.role === 'admin';
  const result = await HostingService.createProjectDownloadToken(
    userId,
    req.params.id as string,
    isAdmin,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Download link created.',
    data: result,
  });
});

const downloadByToken = catchAsync(async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Download token is required.');
  }
  const { absolutePath, downloadName } = await HostingService.resolveProjectDownloadByToken(token);
  res.download(absolutePath, downloadName);
});

const createCpanelLogin = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const isAdmin = req.user.role === 'admin';

  // Prefer proxy headers so production SSO hits the real public API host
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || req.get('host') || '';
  const publicOrigin = host ? `${proto}://${host}` : undefined;

  const result = await HostingService.createCpanelLoginToken(
    userId,
    req.params.id as string,
    isAdmin,
    publicOrigin,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'cPanel login link created.',
    data: result,
  });
});

const cpanelSso = catchAsync(async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) {
    throw new AppError(httpStatus.BAD_REQUEST, 'cPanel login token is required.');
  }

  const result = await HostingService.resolveCpanelSsoResult(token);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (result.mode === 'redirect') {
    res.redirect(302, result.url);
    return;
  }

  // Browser form fallback — always 200 HTML (never 502; Cloudflare turns 502 into its error page)
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "base-uri 'none'",
      "style-src 'unsafe-inline'",
      "script-src 'unsafe-inline'",
      'form-action https: http:',
    ].join('; '),
  );
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(httpStatus.OK).send(result.html);
});

const sendCpanelAccess = catchAsync(async (req, res) => {
  const userId = req.user.userId as string;
  const isAdmin = req.user.role === 'admin';
  const result = await HostingService.sendCpanelAccessEmail(
    userId,
    req.params.id as string,
    isAdmin,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `cPanel access details sent to ${result.emailedTo}.`,
    data: result,
  });
});

export const HostingControllers = {
  createHosting,
  getAllHostings,
  getHostingByIdAdmin,
  updateHosting,
  deleteHosting,
  searchUsers,
  uploadProject,
  uploadProjectChunk,
  completeProjectChunks,
  abortProjectChunks,
  removeProject,
  getMyHostings,
  getMyHostingById,
  downloadMyProject,
  createDownloadToken,
  downloadByToken,
  createCpanelLogin,
  cpanelSso,
  sendCpanelAccess,
};
