// ============================================
// BIT SOFTWARE — Visitor Activity Controller
// ============================================

import { Request, Response } from 'express';
import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { VisitorActivityService } from './visitorActivity.service';
import { IActivityIngestContext } from './visitorActivity.interface';

const clientIp = (req: Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return (req.ip || '').slice(0, 64);
};

const ingestContext = (req: Request): IActivityIngestContext => ({
  userId: req.user?.userId as string | undefined,
  role: req.user?.role as string | undefined,
  ip: clientIp(req),
  userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
});

const recordPageView = catchAsync(async (req: Request, res: Response) => {
  const result = await VisitorActivityService.recordPageView(req.body, ingestContext(req));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.ignored ? 'Page view ignored.' : 'Page view recorded.',
    data: result,
  });
});

const recordHeartbeat = catchAsync(async (req: Request, res: Response) => {
  const result = await VisitorActivityService.recordHeartbeat(req.body, ingestContext(req));
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.ignored ? 'Heartbeat ignored.' : 'Heartbeat recorded.',
    data: result,
  });
});

const recordLeave = catchAsync(async (req: Request, res: Response) => {
  const result = await VisitorActivityService.recordLeave(req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.ignored ? 'Leave ignored.' : 'Leave recorded.',
    data: result,
  });
});

const recordEvent = catchAsync(async (req: Request, res: Response) => {
  const result = await VisitorActivityService.recordEvent(req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.ignored ? 'Event ignored.' : 'Event recorded.',
    data: result,
  });
});

const getLiveSessions = catchAsync(async (_req: Request, res: Response) => {
  const result = await VisitorActivityService.getLiveSessions();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Live visitors retrieved.',
    data: result,
  });
});

const getSessions = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await VisitorActivityService.getSessions(
    req.query as Record<string, unknown>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Sessions retrieved.',
    meta: {
      page: meta.page,
      limit: meta.limit,
      total: meta.total,
      totalPage: meta.totalPages,
    },
    data,
  });
});

const getSessionById = catchAsync(async (req: Request, res: Response) => {
  const result = await VisitorActivityService.getSessionById(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Session retrieved.',
    data: result,
  });
});

export const VisitorActivityControllers = {
  recordPageView,
  recordHeartbeat,
  recordLeave,
  recordEvent,
  getLiveSessions,
  getSessions,
  getSessionById,
};
