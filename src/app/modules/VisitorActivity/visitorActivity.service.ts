// ============================================
// BIT SOFTWARE — Visitor Activity Service
// ============================================

import httpStatus from 'http-status';
import { Types } from 'mongoose';
import AppError from '../../errors/AppError';
import { User } from '../User/user.model';
import { ActivitySession } from './visitorActivity.model';
import {
  IActivityIngestContext,
  IActivityPage,
  IActivitySession,
} from './visitorActivity.interface';
import {
  classifySource,
  detectIntent,
  isCheckoutPath,
  isDashboardPath,
  parseDevice,
} from './visitorActivity.helpers';

const STALE_MS = 60 * 1000;
const LIVE_MS = 45 * 1000;
const IGNORED = { ignored: true as const };

const closeOpenPage = (pages: IActivityPage[], at: Date) => {
  if (!pages.length) return;
  const last = pages[pages.length - 1];
  if (last.leftAt) return;
  last.leftAt = at;
  last.durationMs = Math.max(0, at.getTime() - new Date(last.enteredAt).getTime());
};

const attachUserSnapshot = async (
  session: IActivitySession,
  ctx: IActivityIngestContext,
) => {
  if (!ctx.userId) return;
  if (!Types.ObjectId.isValid(ctx.userId)) return;

  const user = await User.findById(ctx.userId).select('name email userCode role');
  if (!user) return;

  session.userId = user._id as Types.ObjectId;
  session.name = user.name;
  session.email = user.email;
  session.userCode = user.userCode;
  session.role = user.role;
};

const applyDeviceMeta = (
  session: IActivitySession,
  ctx: IActivityIngestContext,
  extras?: { language?: string; path?: string; referrer?: string },
) => {
  if (ctx.ip && !session.ip) session.ip = ctx.ip;
  if (ctx.userAgent && !session.userAgent) session.userAgent = ctx.userAgent.slice(0, 500);
  if (extras?.language && !session.language) session.language = extras.language;

  if (!session.device || !session.browser) {
    const parsed = parseDevice(ctx.userAgent || session.userAgent);
    if (!session.device) session.device = parsed.device;
    if (!session.browser) session.browser = parsed.browser;
  }

  if (extras?.path) session.intent = detectIntent(extras.path);

  if (!session.source) {
    const classified = classifySource(extras?.referrer, extras?.path);
    session.source = classified.source;
    if (classified.utm.medium) session.utmMedium = classified.utm.medium;
    if (classified.utm.campaign) session.utmCampaign = classified.utm.campaign;
  }
  if (extras?.referrer && !session.referrer) {
    const classified = classifySource(extras.referrer, extras.path);
    if (classified.source !== 'direct' || extras.referrer) {
      session.referrer = extras.referrer.slice(0, 500);
    }
  }
};

const shouldIgnoreIngest = (_ctx: IActivityIngestContext, path?: string) => {
  if (path && isDashboardPath(path)) return true;
  return false;
};

const markStaleSessionsLeft = async () => {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await ActivitySession.find({
    status: 'active',
    lastSeenAt: { $lt: cutoff },
  }).limit(200);

  const now = new Date();
  await Promise.all(
    stale.map(async (session) => {
      closeOpenPage(session.pages, session.lastSeenAt || now);
      session.exitPage = session.currentPage || session.exitPage;
      session.status = 'left';
      session.endedAt = session.lastSeenAt || now;
      await session.save();
    }),
  );
};

const recordPageView = async (
  payload: {
    sessionId: string;
    visitorId: string;
    path: string;
    title?: string;
    language?: string;
    referrer?: string;
  },
  ctx: IActivityIngestContext,
) => {
  if (shouldIgnoreIngest(ctx, payload.path)) return IGNORED;

  const now = new Date();
  let session = await ActivitySession.findOne({ sessionId: payload.sessionId });
  const meta = { language: payload.language, path: payload.path, referrer: payload.referrer };

  if (!session) {
    const priorCount = await ActivitySession.countDocuments({ visitorId: payload.visitorId });
    session = new ActivitySession({
      sessionId: payload.sessionId,
      visitorId: payload.visitorId,
      pages: [
        {
          path: payload.path,
          title: payload.title,
          enteredAt: now,
        },
      ],
      entryPage: payload.path,
      currentPage: payload.path,
      startedAt: now,
      lastSeenAt: now,
      status: 'active',
      isReturning: priorCount > 0,
    });
    applyDeviceMeta(session, ctx, meta);
    await attachUserSnapshot(session, ctx);
    await session.save();
    return { ignored: false as const, sessionId: session.sessionId };
  }

  session.visitorId = payload.visitorId || session.visitorId;
  session.lastSeenAt = now;
  session.status = 'active';
  session.endedAt = null;
  session.exitPage = null;
  applyDeviceMeta(session, ctx, meta);
  await attachUserSnapshot(session, ctx);

  const last = session.pages[session.pages.length - 1];
  if (last && !last.leftAt && last.path === payload.path) {
    if (payload.title && !last.title) last.title = payload.title;
    await session.save();
    return { ignored: false as const, sessionId: session.sessionId };
  }

  closeOpenPage(session.pages, now);
  session.pages.push({
    path: payload.path,
    title: payload.title,
    enteredAt: now,
  });
  if (!session.entryPage) session.entryPage = payload.path;
  session.currentPage = payload.path;
  await session.save();
  return { ignored: false as const, sessionId: session.sessionId };
};

const recordHeartbeat = async (
  payload: { sessionId: string; visitorId?: string },
  ctx: IActivityIngestContext,
) => {
  if (shouldIgnoreIngest(ctx)) return IGNORED;

  const session = await ActivitySession.findOne({ sessionId: payload.sessionId });
  if (!session) return IGNORED;

  const now = new Date();
  session.lastSeenAt = now;
  session.status = 'active';
  session.endedAt = null;
  if (payload.visitorId) session.visitorId = payload.visitorId;
  applyDeviceMeta(session, ctx);
  await attachUserSnapshot(session, ctx);
  await session.save();
  return { ignored: false as const, sessionId: session.sessionId };
};

const recordLeave = async (payload: { sessionId: string }) => {
  const session = await ActivitySession.findOne({ sessionId: payload.sessionId });
  if (!session) return IGNORED;

  const now = new Date();
  closeOpenPage(session.pages, now);
  session.exitPage = session.currentPage || session.exitPage;
  session.status = 'left';
  session.endedAt = now;
  session.lastSeenAt = now;
  await session.save();
  return { ignored: false as const, sessionId: session.sessionId };
};

const recordEvent = async (
  payload: { sessionId: string; type: 'whatsapp'; path?: string },
) => {
  const session = await ActivitySession.findOne({ sessionId: payload.sessionId });
  if (!session) return IGNORED;

  const now = new Date();
  session.lastSeenAt = now;
  session.status = 'active';
  session.endedAt = null;
  session.whatsappClicks = (session.whatsappClicks || 0) + 1;
  session.events = session.events || [];
  session.events.push({ type: payload.type, at: now, path: payload.path });
  await session.save();
  return { ignored: false as const, sessionId: session.sessionId };
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const getLiveSessions = async () => {
  await markStaleSessionsLeft();
  const since = new Date(Date.now() - LIVE_MS);
  const today = startOfToday();

  const [
    visitors,
    todaySessions,
    todayLoggedIn,
    abandonedCheckout,
    whatsappAgg,
    topPages,
  ] = await Promise.all([
    ActivitySession.find({
      status: 'active',
      lastSeenAt: { $gte: since },
    })
      .sort({ lastSeenAt: -1 })
      .limit(200)
      .lean(),
    ActivitySession.countDocuments({ startedAt: { $gte: today } }),
    ActivitySession.countDocuments({
      startedAt: { $gte: today },
      userId: { $exists: true, $ne: null },
    }),
    ActivitySession.countDocuments({
      startedAt: { $gte: today },
      status: 'left',
      $or: [
        { intent: 'checkout' },
        { 'pages.path': { $regex: 'checkout|/cart', $options: 'i' } },
      ],
    }),
    ActivitySession.aggregate([
      { $match: { startedAt: { $gte: today } } },
      { $group: { _id: null, clicks: { $sum: { $ifNull: ['$whatsappClicks', 0] } } } },
    ]),
    ActivitySession.aggregate([
      { $match: { startedAt: { $gte: today } } },
      { $unwind: '$pages' },
      {
        $group: {
          _id: { $arrayElemAt: [{ $split: ['$pages.path', '?'] }, 0] },
          views: { $sum: 1 },
        },
      },
      { $sort: { views: -1 } },
      { $limit: 8 },
      { $project: { _id: 0, path: '$_id', views: 1 } },
    ]),
  ]);

  const onCheckout = visitors.filter((v) => isCheckoutPath(v.currentPage || '')).length;

  return {
    visitors,
    topPages,
    stats: {
      liveNow: visitors.length,
      todaySessions,
      todayLoggedIn,
      todayGuests: Math.max(0, todaySessions - todayLoggedIn),
      onCheckout,
      abandonedCheckout,
      whatsappClicks: whatsappAgg[0]?.clicks || 0,
    },
  };
};

const getSessions = async (query: Record<string, unknown> = {}) => {
  await markStaleSessionsLeft();

  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];

  if (query.status === 'active' || query.status === 'left') {
    filter.status = query.status;
  }

  if (query.userId && Types.ObjectId.isValid(String(query.userId))) {
    filter.userId = query.userId;
  }

  if (query.visitorType === 'customer') {
    filter.userId = { $exists: true, $ne: null };
  } else if (query.visitorType === 'guest') {
    and.push({ $or: [{ userId: { $exists: false } }, { userId: null }] });
  }

  if (query.device && ['mobile', 'desktop', 'tablet'].includes(String(query.device))) {
    filter.device = query.device;
  }

  if (query.intent && ['checkout', 'contact', 'auth', 'service', 'account', 'browse'].includes(String(query.intent))) {
    filter.intent = query.intent;
  }

  if (query.source && String(query.source).trim()) {
    filter.source = String(query.source).trim().toLowerCase();
  }

  if (query.from || query.to) {
    const startedAt: Record<string, Date> = {};
    if (query.from) {
      const from = new Date(String(query.from));
      if (!Number.isNaN(from.getTime())) startedAt.$gte = from;
    }
    if (query.to) {
      const to = new Date(String(query.to));
      if (!Number.isNaN(to.getTime())) startedAt.$lte = to;
    }
    if (Object.keys(startedAt).length) filter.startedAt = startedAt;
  }

  if (query.search && String(query.search).trim()) {
    const term = String(query.search).trim();
    and.push({
      $or: [
        { name: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { userCode: { $regex: term, $options: 'i' } },
        { currentPage: { $regex: term, $options: 'i' } },
        { exitPage: { $regex: term, $options: 'i' } },
        { entryPage: { $regex: term, $options: 'i' } },
        { 'pages.path': { $regex: term, $options: 'i' } },
      ],
    });
  }

  if (and.length) filter.$and = and;

  const [data, total] = await Promise.all([
    ActivitySession.find(filter).sort({ lastSeenAt: -1 }).skip(skip).limit(limit).lean(),
    ActivitySession.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

const getSessionById = async (id: string) => {
  const session = Types.ObjectId.isValid(id)
    ? await ActivitySession.findById(id).lean()
    : await ActivitySession.findOne({ sessionId: id }).lean();

  if (!session) {
    throw new AppError(httpStatus.NOT_FOUND, 'Session not found');
  }

  return session;
};

export const VisitorActivityService = {
  recordPageView,
  recordHeartbeat,
  recordLeave,
  recordEvent,
  getLiveSessions,
  getSessions,
  getSessionById,
};
