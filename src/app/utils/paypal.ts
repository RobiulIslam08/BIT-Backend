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
 * @param serviceType - 'gmb' | 'domain' | 'hosting' — for correct return URLs
 */
export const createPayPalOrder = async (
  amountUSD: string,
  description: string,
  serviceType: 'gmb' | 'domain' | 'hosting' | 'wallet' = 'gmb',
): Promise<any> => {
  const accessToken = await getPayPalAccessToken();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const returnUrls: Record<string, string> = {
    domain: `${frontendUrl}/domain-checkout/success`,
    hosting: `${frontendUrl}/hosting-checkout/success`,
    gmb: `${frontendUrl}/services/google-my-business`,
    wallet: `${frontendUrl}/my-account?tab=wallet`,
  };
  const cancelUrls: Record<string, string> = {
    domain: `${frontendUrl}/domain-checkout`,
    hosting: `${frontendUrl}/hosting-checkout`,
    gmb: `${frontendUrl}/services/google-my-business`,
    wallet: `${frontendUrl}/my-account?tab=wallet`,
  };
  const returnUrl = returnUrls[serviceType] || returnUrls.gmb;
  const cancelUrl = cancelUrls[serviceType] || cancelUrls.gmb;

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

// ============================================
// PayPal Vault — Save Payment Method + Merchant-Initiated Charge
// ============================================
// Used for domain AUTO-RENEW (charge the customer without them being present).
//
// Flow:
//   1. createVaultSetupToken()          → server creates a setup token
//   2. (frontend) buyer approves saving their PayPal
//   3. createVaultPaymentToken(setupId) → server exchanges for a reusable token
//   4. chargeVaultedPayPal(vaultId, …)  → server charges the saved token later
//
// ⚠️ Merchant-initiated charges require the PayPal business account to have
//    "Reference Transactions / Vaulting" enabled. If it is not enabled the
//    charge call throws — callers must fall back to notify-and-manual-renew.

/**
 * Step 1: Create a Vault setup token so a buyer can save their PayPal account
 * for future merchant-initiated charges (domain auto-renew).
 *
 * Minimal payload — extra vault flags can trigger
 * "not allowed to vault the given source" on accounts that only have
 * basic Save PayPal enabled (or none at all).
 */
export const createVaultSetupToken = async (
  returnUrl: string,
  cancelUrl: string,
): Promise<any> => {
  const accessToken = await getPayPalAccessToken();
  try {
    const response = await axios({
      url: `${getPayPalBaseUrl()}/v3/vault/setup-tokens`,
      method: 'post',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `setup-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        Prefer: 'return=representation',
      },
      data: {
        payment_source: {
          paypal: {
            usage_type: 'MERCHANT',
            experience_context: {
              brand_name: 'BIT Software & IT Solution',
              return_url: returnUrl,
              cancel_url: cancelUrl,
              shipping_preference: 'NO_SHIPPING',
            },
          },
        },
      },
    });
    return response.data;
  } catch (error: any) {
    const details = error.response?.data;
    console.error('Failed to create PayPal vault setup token:', details || error.message);
    const issue =
      details?.details?.[0]?.description ||
      details?.message ||
      error.message;
    // Surface PayPal vault-permission errors clearly for the UI / merchant.
    if (
      typeof issue === 'string' &&
      /not allowed to vault|PERMISSION_DENIED|vault/i.test(issue)
    ) {
      throw new Error(
        'PayPal vaulting is not enabled on this merchant account. Enable "Save PayPal payment methods" / Vault (Reference Transactions) in PayPal, or contact PayPal support.',
      );
    }
    throw new Error(issue || 'Could not start saving the payment method.');
  }
};

/**
 * Step 3: Exchange an approved setup token for a reusable payment (vault) token.
 */
export const createVaultPaymentToken = async (
  setupTokenId: string,
): Promise<{ vaultId: string; email?: string; customerId?: string }> => {
  const accessToken = await getPayPalAccessToken();
  try {
    const response = await axios({
      url: `${getPayPalBaseUrl()}/v3/vault/payment-tokens`,
      method: 'post',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `token-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        Prefer: 'return=representation',
      },
      data: {
        payment_source: {
          token: { id: setupTokenId, type: 'SETUP_TOKEN' },
        },
      },
    });
    const data = response.data;
    return {
      vaultId: data?.id,
      email: data?.payment_source?.paypal?.email_address,
      customerId: data?.customer?.id,
    };
  } catch (error: any) {
    const details = error.response?.data;
    console.error('Failed to create PayPal vault payment token:', details || error.message);
    const issue = details?.details?.[0]?.description || details?.message;
    throw new Error(issue || 'Could not save the payment method.');
  }
};

/**
 * Step 4: Charge a previously saved (vaulted) PayPal account — buyer not present.
 */
export const chargeVaultedPayPal = async (
  vaultId: string,
  amountUSD: string,
  description: string,
): Promise<{ captureId: string; orderId: string }> => {
  const accessToken = await getPayPalAccessToken();
  try {
    const response = await axios({
      url: `${getPayPalBaseUrl()}/v2/checkout/orders`,
      method: 'post',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `renew-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        Prefer: 'return=representation',
      },
      data: {
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: amountUSD },
            description,
          },
        ],
        payment_source: {
          paypal: {
            vault_id: vaultId,
            stored_credential: {
              payment_initiator: 'MERCHANT',
              usage: 'SUBSEQUENT',
              usage_pattern: 'IMMEDIATE',
            },
          },
        },
      },
    });

    let order = response.data;

    // If not auto-completed, explicitly capture.
    if (order?.status !== 'COMPLETED') {
      const captureRes = await axios({
        url: `${getPayPalBaseUrl()}/v2/checkout/orders/${order.id}/capture`,
        method: 'post',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        data: {},
      });
      order = captureRes.data;
    }

    if (order?.status !== 'COMPLETED') {
      throw new Error(`Charge not completed. Status: ${order?.status}`);
    }

    const captureId = order?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    if (!captureId) {
      throw new Error('Charge completed but no capture id was returned.');
    }
    return { captureId, orderId: order.id };
  } catch (error: any) {
    const details = error.response?.data;
    console.error('Failed to charge vaulted PayPal:', details || error.message);
    throw new Error(
      details?.details?.[0]?.description ||
        details?.message ||
        'Automatic payment could not be processed with the saved payment method.',
    );
  }
};

/**
 * Delete a saved payment (vault) token.
 */
export const deleteVaultPaymentToken = async (vaultId: string): Promise<void> => {
  const accessToken = await getPayPalAccessToken();
  try {
    await axios({
      url: `${getPayPalBaseUrl()}/v3/vault/payment-tokens/${vaultId}`,
      method: 'delete',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error: any) {
    // Non-fatal — log only. The local record is removed regardless.
    console.error('Failed to delete PayPal vault token:', error.response?.data || error.message);
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
