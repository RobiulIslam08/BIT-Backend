// ============================================
// BIT SOFTWARE — Hosting Asset Routes  (/api/v1/hostings)
// ============================================

import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import rateLimit from 'express-rate-limit';
import httpStatus from 'http-status';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import AppError from '../../errors/AppError';
import { getHostingProjectsDir } from '../../utils/uploadPaths';
import { HostingControllers } from './hosting.controller';
import { HostingValidation } from './hosting.validation';

const router = express.Router();

/** Max project archive size — covers 200–400 MB client projects with headroom. */
export const HOSTING_PROJECT_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

// Disk storage — large ZIPs must NOT use memoryStorage (would OOM at 200–400 MB).
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      const dir = getHostingProjectsDir();
      cb(null, dir);
    } catch (err) {
      cb(err as Error, getHostingProjectsDir());
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.zip';
    const safe = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: HOSTING_PROJECT_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const okExt = ['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext);
    const okMime =
      /zip|x-zip|x-rar|x-7z|x-tar|gzip|octet-stream/i.test(file.mimetype) ||
      file.mimetype === 'application/x-compressed';
    if (okExt || okMime) cb(null, true);
    else cb(new Error('Only archive files (ZIP, RAR, 7Z) are allowed.'));
  },
});

/** Translate multer errors into clear API messages. */
const handleProjectUpload = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  upload.single('projectFile')(req, res, (err: unknown) => {
    if (!err) return next();

    // Clean orphaned temp file if multer wrote one before failing
    const f = (req as express.Request & { file?: Express.Multer.File }).file;
    if (f?.path && fs.existsSync(f.path)) {
      try { fs.unlinkSync(f.path); } catch { /* ignore */ }
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            httpStatus.REQUEST_ENTITY_TOO_LARGE,
            'File too large. Maximum project ZIP size is 500 MB.',
          ),
        );
      }
      return next(new AppError(httpStatus.BAD_REQUEST, `Upload failed: ${err.message}`));
    }

    if (err instanceof Error) {
      return next(new AppError(httpStatus.BAD_REQUEST, err.message));
    }

    return next(err);
  });
};

const downloadLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many download attempts. Please wait 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// ─── PUBLIC: token-based streaming download (for large ZIPs) ───
router.get('/download-file', downloadLimit, HostingControllers.downloadByToken);

// ─── ADMIN: user picker ───
router.get('/admin/users', auth('admin'), HostingControllers.searchUsers);

// ─── USER: own hostings ───
router.get('/my', auth('user', 'admin'), HostingControllers.getMyHostings);
router.get('/my/:id', auth('user', 'admin'), HostingControllers.getMyHostingById);
router.post(
  '/my/:id/download-token',
  auth('user', 'admin'),
  downloadLimit,
  HostingControllers.createDownloadToken,
);
router.get(
  '/my/:id/download',
  auth('user', 'admin'),
  downloadLimit,
  HostingControllers.downloadMyProject,
);

// ─── ADMIN: CRUD + project upload ───
router.get('/', auth('admin'), HostingControllers.getAllHostings);
router.post(
  '/',
  auth('admin'),
  validateRequest(HostingValidation.createHostingValidationSchema),
  HostingControllers.createHosting,
);
router.get('/:id', auth('admin'), HostingControllers.getHostingByIdAdmin);
router.patch(
  '/:id',
  auth('admin'),
  validateRequest(HostingValidation.updateHostingValidationSchema),
  HostingControllers.updateHosting,
);
router.delete('/:id', auth('admin'), HostingControllers.deleteHosting);
router.post(
  '/:id/project',
  auth('admin'),
  handleProjectUpload,
  HostingControllers.uploadProject,
);
router.delete('/:id/project', auth('admin'), HostingControllers.removeProject);

export const HostingRoutes = router;
