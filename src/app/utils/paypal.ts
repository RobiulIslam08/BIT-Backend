// ============================================
// BIT SOFTWARE — PayPal Verification Utility
// ============================================
// Securely fetches PayPal order details by querying
// the official PayPal API directly (server-to-server).
// This prevents client-side payment spoofing.

import axios from 'axios';

const getPayPalBaseUrl = (): string => {
  return process.env.PAYPAL_MODE?.toLowerCase() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
};

/**
 * Get Access Token from PayPal OAuth2 API
 */
const getPayPalAccessToken = async (): Promise<string> => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials are not configured in environment variables.');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const response = await axios({
      url: `${getPayPalBaseUrl()}/v1/oauth2/token`,
      method: 'post',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en_US',
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: 'grant_type=client_credentials',
    });
    return response.data.access_token;
  } catch (error: any) {
    console.error(
      'PayPal OAuth token generation failed:',
      error.response?.data || error.message,
    );
    throw new Error('PayPal Authentication failed');
  }
};

/**
 * Get Order Details from PayPal by Order ID
 * Used to verify payment status and amount server-side.
 */
export const getPayPalOrderDetails = async (orderId: string): Promise<any> => {
  const accessToken = await getPayPalAccessToken();

  try {
    const response = await axios({
      url: `${getPayPalBaseUrl()}/v2/checkout/orders/${orderId}`,
      method: 'get',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error(
      'Failed to fetch PayPal order details:',
      error.response?.data || error.message,
    );
    throw new Error('PayPal order verification failed');
  }
};

/**
 * Capture payment for a PayPal order by Order ID
 */
export const capturePayPalOrder = async (orderId: string): Promise<any> => {
  const accessToken = await getPayPalAccessToken();

  try {
    const response = await axios({
      url: `${getPayPalBaseUrl()}/v2/checkout/orders/${orderId}/capture`,
      method: 'post',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {},
    });
    return response.data;
  } catch (error: any) {
    console.error(
      'Failed to capture PayPal order:',
      error.response?.data || error.message,
    );
    throw new Error('PayPal order capture failed');
  }
};

/**
 * Create a PayPal order server-side (server-to-server).
 * This replaces the deprecated client-side actions.order.create().
 * @param amountUSD - Amount in USD (already converted)
 * @param description - Order description shown to buyer
 */
export const createPayPalOrder = async (
  amountUSD: string,
  description: string,
): Promise<any> => {
  const accessToken = await getPayPalAccessToken();

  try {
    const response = await axios({
      url: `${getPayPalBaseUrl()}/v2/checkout/orders`,
      method: 'post',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `bit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      },
      data: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: {
              currency_code: 'USD',
              value: amountUSD,
            },
            description,
          },
        ],
        application_context: {
          brand_name: 'BIT Software & IT Solution',
          user_action: 'PAY_NOW',
          return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/services/google-my-business`,
          cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/services/google-my-business`,
        },
      },
    });
    return response.data;
  } catch (error: any) {
    console.error(
      'Failed to create PayPal order (server-side):',
      error.response?.data || error.message,
    );
    throw new Error('PayPal order creation failed');
  }
};
