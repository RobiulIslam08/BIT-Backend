// ============================================
// BIT SOFTWARE — Tabby Business Order Routes
// ============================================

import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { TabbyOrderControllers } from './tabbyOrder.controller';
import auth from '../../middleware/auth';

const router = express.Router();

const orderRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many order submissions. Please wait 15 minutes before trying again.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

const fileFilter = (
  req: express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Invalid file type. Only JPEG, PNG, WebP, or PDF is allowed.'));
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: 4 * 1024 * 1024,
    files: 5,
  },
});

const uploadFields = upload.fields([
  { name: 'crCopy', maxCount: 1 },
  { name: 'nationalAddressPdf', maxCount: 1 },
  { name: 'vatCertificate', maxCount: 1 },
  { name: 'ibanCertificate', maxCount: 1 },
  { name: 'ownerIdCopy', maxCount: 1 },
]);

const handleUpload = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  uploadFields(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'File too large. Maximum size is 4MB per file.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ success: false, message: `File upload error: ${err.message}` });
      }
      return res.status(400).json({ success: false, message: `File upload error: ${err.message}` });
    }
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
};

router.post('/create-paypal-order', auth('user', 'admin'), TabbyOrderControllers.createPayPalOrder);
router.post('/', auth('user', 'admin'), orderRateLimit, handleUpload, TabbyOrderControllers.submitOrder);
router.post('/pay-with-wallet', auth('user', 'admin'), orderRateLimit, handleUpload, TabbyOrderControllers.payWithWallet);

router.get('/my', auth('user', 'admin'), TabbyOrderControllers.getMyOrders);
router.get('/my/:id', auth('user', 'admin'), TabbyOrderControllers.getMyOrderById);
router.post('/:id/refund-request', auth('user', 'admin'), TabbyOrderControllers.requestRefund);
router.get('/:id/files/:fileId', auth('user', 'admin'), TabbyOrderControllers.downloadFile);

router.get('/', auth('admin'), TabbyOrderControllers.getAllOrders);
router.patch('/:id', auth('admin'), TabbyOrderControllers.updateOrder);
router.post('/:id/refund', auth('admin'), TabbyOrderControllers.processRefund);
router.delete('/:id', auth('admin'), TabbyOrderControllers.deleteOrder);

export const TabbyOrderRoutes = router;
