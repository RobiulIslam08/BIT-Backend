// ============================================
// BIT SOFTWARE — Namecheap API Helper (Internal)
// ============================================
// Centralised, server-side Namecheap integration used for:
//   1. Live RENEW pricing lookup  → getRenewPriceUSD(tld)
//   2. Programmatic domain renewal → renewDomainOnNamecheap(domainName, years)
//
// ⚠️  WHITE-LABEL: This provider is used strictly behind the scenes.
//     Never surface the word "Namecheap" (or any provider name) in any
//     message that can reach an end customer. All customer-facing errors
//     must be generic (see callers).
//
// Namecheap API docs:
//   https://www.namecheap.com/support/api/methods/users/get-pricing/
//   https://www.namecheap.com/support/api/methods/domains/renew/
// ============================================

import axios from 'axios';
import { parseStringPromise } from 'xml2js';

// ─── Config helpers ───
const buildApiUrl = (): string => {
  const env = process.env.NAMECHEAP_ENV || 'production';
  return env === 'sandbox'
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response';
};

const getCredentials = (): { apiKey: string; apiUser: string } => {
  const apiKey = process.env.NAMECHEAP_API_KEY?.trim();
  const apiUser = process.env.NAMECHEAP_API_USER?.trim();
  if (!apiKey || !apiUser) {
    throw new Error('Registrar API is not configured on the server.');
  }
  return { apiKey, apiUser };
};

// ─── Client IP (configured or auto-detected) ───
let cachedIp: string | null = null;
let cachedIpAt = 0;
const IP_CACHE_MS = 10 * 60 * 1000;

const getClientIp = async (): Promise<string> => {
  const configured = process.env.NAMECHEAP_CLIENT_IP?.trim();
  if (configured && configured !== '' && configured !== 'YOUR_SERVER_PUBLIC_IP_HERE') {
    return configured;
  }
  const now = Date.now();
  if (cachedIp && now - cachedIpAt < IP_CACHE_MS) return cachedIp;

  const services = ['https://api.ipify.org', 'https://api4.my-ip.io/ip', 'https://ipv4.icanhazip.com'];
  for (const svc of services) {
    try {
      const res = await axios.get(svc, { timeout: 5000 });
      const ip = String(res.data).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        cachedIp = ip;
        cachedIpAt = now;
        return ip;
      }
    } catch {
      // try next
    }
  }
  throw new Error('Unable to determine server IP for registrar API.');
};

// ─── XML parse + error extraction ───
const parseXml = async (xml: string): Promise<any> => {
  const parsed = await parseStringPromise(xml, {
    explicitArray: false,
    ignoreAttrs: false,
    mergeAttrs: true,
  });
  const apiResponse = parsed?.ApiResponse;
  if (!apiResponse) {
    throw new Error('Invalid registrar API response.');
  }
  if (apiResponse.Status === 'ERROR') {
    const errors = apiResponse.Errors?.Error;
    const msg = Array.isArray(errors)
      ? errors.map((e: any) => e._ || e).join(', ')
      : errors?._ || errors || 'Unknown registrar API error';
    throw new Error(String(msg));
  }
  return apiResponse;
};

const toArray = <T>(v: T | T[] | undefined | null): T[] => {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
};

const findByName = <T extends { Name?: string }>(items: T[], name: string): T | undefined =>
  items.find((i) => (i.Name || '').toLowerCase() === name.toLowerCase());

// ─── RENEW pricing cache (per TLD, 12h) ───
interface CachedPrice {
  priceUSD: number;
  at: number;
}
const renewPriceCache = new Map<string, CachedPrice>();
const PRICE_CACHE_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Read a cached renew price without hitting the registrar.
 * Used by the public pricing endpoint so the website never blocks on Namecheap.
 */
export const peekCachedRenewPriceUSD = (tld: string): number | null => {
  const key = tld.replace(/^\./, '').toLowerCase();
  if (!key) return null;
  const cached = renewPriceCache.get(key);
  if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.priceUSD;
  return null;
};

/**
 * Get the live RENEW price (in USD) for a TLD from the registrar.
 * This is the amount the platform is charged to renew — passed through
 * to the customer as their renewal fee.
 *
 * Returns `null` if the price cannot be determined (caller decides fallback).
 */
export const getRenewPriceUSD = async (tld: string): Promise<number | null> => {
  const key = tld.replace(/^\./, '').toLowerCase();
  if (!key) return null;

  const cached = renewPriceCache.get(key);
  if (cached && Date.now() - cached.at < PRICE_CACHE_MS) {
    return cached.priceUSD;
  }

  try {
    const { apiKey, apiUser } = getCredentials();
    const clientIp = await getClientIp();
    const apiUrl = buildApiUrl();

    const params = {
      ApiUser: apiUser,
      ApiKey: apiKey,
      UserName: apiUser,
      ClientIp: clientIp,
      Command: 'namecheap.users.getPricing',
      ProductType: 'DOMAIN',
      ProductCategory: 'DOMAINS',
      ActionName: 'RENEW',
      ProductName: key,
    };

    const res = await axios.get(apiUrl, { params, timeout: 15000 });
    const apiResponse = await parseXml(res.data);

    const result = apiResponse?.CommandResponse?.UserGetPricingResult;
    const productTypes = toArray<any>(result?.ProductType);
    const domainType = findByName(productTypes, 'domains') || productTypes[0];
    if (!domainType) return null;

    const categories = toArray<any>(domainType.ProductCategory);
    // RENEW action maps to the "renew" category
    const renewCat = findByName(categories, 'renew') || categories[0];
    if (!renewCat) return null;

    const products = toArray<any>(renewCat.Product);
    const product = findByName(products, key) || products[0];
    if (!product) return null;

    const prices = toArray<any>(product.Price);
    // Prefer 1-year renewal price
    const oneYear =
      prices.find((p) => String(p.Duration) === '1' && String(p.DurationType).toUpperCase() === 'YEAR') ||
      prices[0];
    if (!oneYear) return null;

    // "YourPrice" is what the platform (API account) is charged → the true cost.
    const raw = oneYear.YourPrice ?? oneYear.Price ?? oneYear.RegularPrice;
    const priceUSD = parseFloat(String(raw));
    if (!Number.isFinite(priceUSD) || priceUSD <= 0) return null;

    renewPriceCache.set(key, { priceUSD, at: Date.now() });
    return priceUSD;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[Registrar] Renew price lookup failed for .${key}:`, (err as Error).message);
    return null;
  }
};

/**
 * Renew a domain programmatically at the registrar.
 * Only valid for domains registered/managed through us.
 * Returns the charged amount (USD) and the new expiry date.
 */
export const renewDomainOnNamecheap = async (
  domainName: string,
  years: number,
): Promise<{ chargedAmountUSD: number | null; expiresAt: Date | null; providerOrderId: string | null }> => {
  const { apiKey, apiUser } = getCredentials();
  const clientIp = await getClientIp();
  const apiUrl = buildApiUrl();

  const params = new URLSearchParams({
    ApiUser: apiUser,
    ApiKey: apiKey,
    UserName: apiUser,
    ClientIp: clientIp,
    Command: 'namecheap.domains.renew',
    DomainName: domainName,
    Years: String(years),
  });

  const res = await axios.post(apiUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000,
  });

  const apiResponse = await parseXml(res.data);
  const result = apiResponse?.CommandResponse?.DomainRenewResult;

  if (!result || String(result.Renew).toLowerCase() !== 'true') {
    throw new Error('Domain renewal was not confirmed by the registrar.');
  }

  const chargedAmountUSD = result.ChargedAmount ? parseFloat(String(result.ChargedAmount)) : null;
  const providerOrderId = result.OrderID ? `NC-${result.OrderID}` : null;

  // Namecheap returns the new expiry inside DomainDetails.ExpiredDate (best effort).
  let expiresAt: Date | null = null;
  const expiredDate = result?.DomainDetails?.ExpiredDate;
  if (expiredDate) {
    const d = new Date(expiredDate);
    if (!Number.isNaN(d.getTime())) expiresAt = d;
  }

  return { chargedAmountUSD, expiresAt, providerOrderId };
};
