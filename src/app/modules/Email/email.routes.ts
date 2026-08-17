// ============================================
// BIT SOFTWARE — Email Asset Routes  (/api/v1/emails)
// ============================================

import express from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validationRequest';
import { EmailControllers } from './email.controller';
import { EmailValidation } from './email.validation';

const router = express.Router();

const accessLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please wait a few minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.get('/admin/users', auth('admin'), EmailControllers.searchUsers);

router.get('/my', auth('user', 'admin'), EmailControllers.getMyEmails);
router.get('/my/:id', auth('user', 'admin'), EmailControllers.getMyEmailById);
router.post(
  '/my/:id/send-webmail-access',
  auth('user', 'admin'),
  accessLimit,
  EmailControllers.sendWebmailAccess,
);

router.get('/', auth('admin'), EmailControllers.getAllEmails);
router.post(
  '/',
  auth('admin'),
  validateRequest(EmailValidation.createEmailValidationSchema),
  EmailControllers.createEmail,
);
router.get('/:id', auth('admin'), EmailControllers.getEmailByIdAdmin);
router.patch(
  '/:id',
  auth('admin'),
  validateRequest(EmailValidation.updateEmailValidationSchema),
  EmailControllers.updateEmail,
);
router.delete('/:id', auth('admin'), EmailControllers.deleteEmail);

export const EmailRoutes = router;
