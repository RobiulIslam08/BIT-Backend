// ============================================
// BIT SOFTWARE — Tabby Business Order Routes
//   POST /api/v1/tabby-orders/create-paypal-order
//   POST /api/v1/tabby-orders/pay-with-wallet
//   POST /api/v1/tabby-orders
//   GET  /api/v1/tabby-orders/my
//   GET  /api/v1/tabby-orders/my/:id
//   POST /api/v1/tabby-orders/:id/refund-request
//   POST /api/v1/tabby-orders/:id/files
//   GET  /api/v1/tabby-orders/:id/files/:fileId
//   GET  /api/v1/tabby-orders
//   PATCH /api/v1/tabby-orders/:id
//   POST /api/v1/tabby-orders/:id/refund
//   DELETE /api/v1/tabby-orders/:id
// ============================================

import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { TabbyOrderControllers } from './tabbyOrder.controller';
import auth from '../../middleware/auth';

const router = express.Router();

const orderRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many order submissions. Please wait 15 minutes before trying again.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

const paypalCreateRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many PayPal checkout attempts. Please wait a few minutes.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

const fileFilter = (
  req: express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Invalid file type. Only JPEG, PNG, WebP, or PDF is allowed.'));
};

const uploadSingle = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: 4 * 1024 * 1024,
    files: 1,
  },
});

const handleSingleUpload = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  uploadSingle.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'File too large. Please upload a photo of the document instead.' });
      }
      return res.status(400).json({ success: false, message: `File upload error: ${err.message}` });
    }
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
};

// Static payment paths MUST be registered before `/:id` routes.
router.post(
  '/create-paypal-order',
  auth('user', 'admin'),
  paypalCreateRateLimit,
  TabbyOrderControllers.createPayPalOrder,
);
router.post(
  '/pay-with-wallet',
  auth('user', 'admin'),
  orderRateLimit,
  TabbyOrderControllers.payWithWallet,
);
router.post(
  '/',
  auth('user', 'admin'),
  orderRateLimit,
  TabbyOrderControllers.submitOrder,
);

router.get('/my', auth('user', 'admin'), TabbyOrderControllers.getMyOrders);
router.get('/my/:id', auth('user', 'admin'), TabbyOrderControllers.getMyOrderById);
router.post('/:id/refund-request', auth('user', 'admin'), TabbyOrderControllers.requestRefund);
router.post('/:id/files', auth('user', 'admin'), handleSingleUpload, TabbyOrderControllers.uploadFile);
router.get('/:id/files/:fileId', auth('user', 'admin'), TabbyOrderControllers.downloadFile);

router.get('/', auth('admin'), TabbyOrderControllers.getAllOrders);
router.patch('/:id', auth('admin'), TabbyOrderControllers.updateOrder);
router.post('/:id/refund', auth('admin'), TabbyOrderControllers.processRefund);
router.delete('/:id', auth('admin'), TabbyOrderControllers.deleteOrder);

export const TabbyOrderRoutes = router;
