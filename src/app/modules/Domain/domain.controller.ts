// ============================================
// BIT SOFTWARE — Domain Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { checkDomainAvailability } from './domain.service';

// POST /api/v1/domain/check
// Body: { domainName: string }
const checkDomain = catchAsync(async (req, res) => {
  const { domainName } = req.body;

  const result = await checkDomainAvailability(domainName);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: 'Domain availability checked successfully.',
    data: result,
  });
});

export const DomainControllers = {
  checkDomain,
};
