// ============================================
// BIT SOFTWARE — GMB Order Routes (Production)
// ============================================

import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { GmbOrderControllers } from './gmbOrder.controller';
import auth from '../../middleware/auth';

const router = express.Router();

// ─── Rate Limiters ───

// Order submission: max 5 per IP per 15 minutes (prevent spam orders)
const orderRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many order submissions. Please wait 15 minutes before trying again.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// Coupon validation: max 20 per IP per 10 minutes (anti brute force)
const couponRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many coupon validation attempts. Please wait before trying again.',
  },
});

// ─── Multer: Memory Storage (Vercel serverless-এ filesystem read-only) ───
// File buffer -> base64 string -> MongoDB-তে সংরক্ষণ হবে
const fileFilter = (
  req: express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, GIF, or PDF allowed.'));
  }
};

const upload = multer({
  storage: multer.memoryStorage(), // ✅ Vercel-এ disk write নেই, memory-তে রাখো
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 1, // Only 1 file per request
  },
});

// ─── Multer error handler wrapper ───
const handleUpload = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  upload.single('paymentScreenshot')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'File too large. Maximum size is 5MB.' });
      }
      return res.status(400).json({ success: false, message: `File upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
};

// ==================== PUBLIC ROUTES ====================

// Submit a new GMB order (rate limited)
router.post('/', orderRateLimit, handleUpload, GmbOrderControllers.submitOrder);

// Create PayPal order server-side (returns PayPal order ID for frontend SDK)
// Must be defined BEFORE the /:id route to avoid conflicts
router.post('/create-paypal-order', GmbOrderControllers.createPayPalOrder);

// Pay for a GMB order using wallet balance (authenticated customers only)
router.post('/pay-with-wallet', auth('user', 'admin'), orderRateLimit, GmbOrderControllers.payWithWallet);

// Validate a coupon code (rate limited, brute-force protected)
router.post('/validate-coupon', couponRateLimit, GmbOrderControllers.validateCoupon);

// Get a single order status (public — customer can check their order)
router.get('/:id', GmbOrderControllers.getOrderById);

// ==================== ADMIN ROUTES (Protected) ====================

// Admin: Get all orders (requires admin authentication)
router.get('/', auth('admin'), GmbOrderControllers.getAllOrders);

// Admin: Update order/payment status (patch)
router.patch('/:id', auth('admin'), GmbOrderControllers.updateOrderStatus);

// Admin: Update order info (put)
router.put('/:id', auth('admin'), GmbOrderControllers.updateOrderInfo);

// Admin: Delete order
router.delete('/:id', auth('admin'), GmbOrderControllers.deleteOrder);

export const GmbOrderRoutes = router;
