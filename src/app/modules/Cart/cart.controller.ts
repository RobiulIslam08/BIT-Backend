// ============================================
// BIT SOFTWARE — Cart Checkout Controller
// ============================================

import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import * as CartService from './cart.service';
import { TSupportedCurrency } from './cart.interface';

const createPayPalOrder = catchAsync(async (req, res) => {
  const { items, displayCurrency, customerName, customerEmail, customerPhone } = req.body;
  const userId = req.user.userId as string;

  const result = await CartService.createCartPayPalOrder({
    items,
    displayCurrency: (displayCurrency || 'SAR') as TSupportedCurrency,
    customerName,
    customerEmail,
    customerPhone,
    userId,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Cart PayPal order created. Proceed to payment.',
    data: result,
  });
});

const completePurchase = catchAsync(async (req, res) => {
  const { paypalOrderId } = req.body;
  const userId = req.user.userId as string;

  const result = await CartService.completeCartPurchase({ paypalOrderId, userId });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      result.status === 'completed'
        ? 'Cart checkout completed successfully.'
        : result.status === 'partial'
          ? 'Cart checkout partially completed. Failed items were refunded where possible.'
          : 'Cart checkout processed.',
    data: result,
  });
});

const payWithWallet = catchAsync(async (req, res) => {
  const { items, displayCurrency, customerName, customerEmail, customerPhone } = req.body;
  const userId = req.user.userId as string;

  const result = await CartService.payCartWithWallet({
    items,
    displayCurrency: (displayCurrency || 'SAR') as TSupportedCurrency,
    customerName,
    customerEmail,
    customerPhone,
    userId,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message:
      result.status === 'completed'
        ? 'Cart paid with wallet successfully.'
        : 'Cart checkout partially completed. Failed items were refunded to your wallet where possible.',
    data: result,
  });
});

export const CartControllers = {
  createPayPalOrder,
  completePurchase,
  payWithWallet,
};
