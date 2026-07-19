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
    console.error('PayPal OAuth token generation failed:', error.response?.data || error.message);
    throw new Error('PayPal Authentication failed');
  }
};

/**
 * Get Order Details from PayPal by Order ID
 */
export const getPayPalOrderDetails = async (orderId: string): Promise<any> => {
  const accessToken = await getPayPalAccessToken();
  try {
    const response = await axios({
      url: `${getPayPalBaseUrl()}/v2/checkout/orders/${orderId}`,
      method: 'get',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    return response.data;
  } catch (error: any) {
    console.error('Failed to fetch PayPal order details:', error.response?.data || error.message);
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
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      data: {},
    });
    return response.data;
  } catch (error: any) {
    console.error('Failed to capture PayPal order:', error.response?.data || error.message);
    throw new Error('PayPal order capture failed');
  }
};

/**
 * Create a PayPal order server-side (server-to-server).
 * @param amountUSD - Amount in USD
 * @param description - Order description shown to buyer
 * @param serviceType - 'gmb' | 'domain' — for correct return URLs
 */
export const createPayPalOrder = async (
  amountUSD: string,
  description: string,
  serviceType: 'gmb' | 'domain' = 'gmb',
): Promise<any> => {
  const accessToken = await getPayPalAccessToken();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const returnUrl = serviceType === 'domain'
    ? `${frontendUrl}/domain-checkout/success`
    : `${frontendUrl}/services/google-my-business`;
  const cancelUrl = serviceType === 'domain'
    ? `${frontendUrl}/domain-checkout`
    : `${frontendUrl}/services/google-my-business`;

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
            amount: { currency_code: 'USD', value: amountUSD },
            description,
          },
        ],
        application_context: {
          brand_name: 'BIT Software & IT Solution',
          user_action: 'PAY_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('Failed to create PayPal order:', error.response?.data || error.message);
    throw new Error('PayPal order creation failed');
  }
};

/**
 * Refund a captured PayPal payment.
 * Called automatically when Namecheap domain registration fails after payment.
 * @param captureId - The PayPal capture ID from the original payment
 * @param amount - Amount to refund in USD string e.g. "15.00"
 * @param currency - Currency code (default: 'USD')
 */
export const refundPayPalCapture = async (
  captureId: string,
  amount: string,
  currency: string = 'USD',
): Promise<any> => {
  const accessToken = await getPayPalAccessToken();
  try {
    const response = await axios({
      url: `${getPayPalBaseUrl()}/v2/payments/captures/${captureId}/refund`,
      method: 'post',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `refund-${captureId}-${Date.now()}`,
      },
      data: {
        amount: { value: amount, currency_code: currency },
        note_to_payer: 'Domain registration failed. Full refund issued by BIT Software & IT Solution.',
      },
    });
    console.log(`[PayPal] Refund successful. Refund ID: ${response.data?.id}`);
    return response.data;
  } catch (error: any) {
    console.error('[PayPal] Refund FAILED — MANUAL ACTION REQUIRED:', error.response?.data || error.message);
    throw new Error(`PayPal refund failed: ${error.response?.data?.message || error.message}`);
  }
};
