// ============================================
// BIT SOFTWARE — Domain Service (Namecheap API Proxy)
// ============================================
// Calls Namecheap XML API server-side to keep API key secure.
// Namecheap API requires:
//   1. API Key  (NAMECHEAP_API_KEY in .env)
//   2. API User (NAMECHEAP_API_USER in .env)
//   3. ClientIP — the PUBLIC IP of this server (auto-detected or from NAMECHEAP_CLIENT_IP in .env)
//      IMPORTANT: This IP must be whitelisted in Namecheap:
//      Namecheap Dashboard → Profile → Tools → Business & Dev Tools → API Access
// API Docs: https://www.namecheap.com/support/api/methods/domains/check/

import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import AppError from '../../errors/AppError';
import httpStatus from 'http-status';

// ─── Namecheap TLD suggestions list ───
const SUGGESTION_TLDS = [
  'com', 'net', 'org', 'io', 'co', 'info', 'biz', 'online',
  'tech', 'store', 'shop', 'app', 'dev', 'site', 'website',
  'cloud', 'digital', 'agency', 'solutions', 'services',
];

// ─── Cached public IP (refreshed every 10 minutes to handle dynamic IPs) ───
let cachedPublicIp: string | null = null;
let cachedIpTimestamp = 0;
const IP_CACHE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get the public IP of this server.
 * - If NAMECHEAP_CLIENT_IP is set in .env → use that (production).
 * - Otherwise auto-detect via external service (development / dynamic IP).
 *
 * ⚠️  Whatever IP is returned MUST be whitelisted in Namecheap API settings.
 */
const getClientIp = async (): Promise<string> => {
  // 1. Use explicitly configured IP if provided (production scenario)
  const configuredIp = process.env.NAMECHEAP_CLIENT_IP?.trim();
  if (configuredIp && configuredIp !== '' &&
      configuredIp !== 'YOUR_SERVER_PUBLIC_IP_HERE') {
    return configuredIp;
  }

  // 2. Auto-detect (development / no static IP configured)
  const now = Date.now();
  if (cachedPublicIp && (now - cachedIpTimestamp) < IP_CACHE_MS) {
    return cachedPublicIp;
  }

  // Try multiple IP detection services for reliability
  const ipServices = [
    'https://api.ipify.org',
    'https://api4.my-ip.io/ip',
    'https://ipv4.icanhazip.com',
  ];

  for (const svc of ipServices) {
    try {
      const res = await axios.get(svc, { timeout: 5000 });
      const ip = (res.data as string).trim();
      // Basic IPv4 validation
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        cachedPublicIp = ip;
        cachedIpTimestamp = now;
        console.log(`[Namecheap] Auto-detected public IP: ${ip}`);
        return ip;
      }
    } catch {
      // Try next service
    }
  }

  throw new AppError(
    httpStatus.INTERNAL_SERVER_ERROR,
    'Could not determine server public IP. Please set NAMECHEAP_CLIENT_IP in .env and whitelist it in your Namecheap API settings.',
  );
};

// ─── Parse SLD (Second-Level Domain) from user input ───
// e.g. "example.com" → { sld: "example", tld: "com" }
// e.g. "example"     → { sld: "example", tld: null }
const parseDomain = (input: string): { sld: string; tld: string | null } => {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');

  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) {
    return { sld: cleaned, tld: null };
  }
  const sld = cleaned.substring(0, firstDot);
  const tld = cleaned.substring(firstDot + 1);
  return { sld, tld };
};

// ─── Build Namecheap API URL ───
const buildNamecheapUrl = (): string => {
  const env = process.env.NAMECHEAP_ENV || 'production';
  return env === 'sandbox'
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response';
};

// ─── Validate required env vars ───
const validateConfig = () => {
  const apiKey = process.env.NAMECHEAP_API_KEY?.trim();
  const apiUser = process.env.NAMECHEAP_API_USER?.trim();

  if (!apiKey || apiKey === 'YOUR_NAMECHEAP_API_KEY_HERE') {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Namecheap API Key is not configured. Please set NAMECHEAP_API_KEY in .env',
    );
  }
  if (!apiUser || apiUser === 'YOUR_NAMECHEAP_USERNAME_HERE') {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Namecheap API User is not configured. Please set NAMECHEAP_API_USER in .env',
    );
  }
  return { apiKey, apiUser };
};

// ─── Single Namecheap API call — check a list of domains ───
const callNamecheapCheck = async (domainList: string[]): Promise<DomainCheckResult[]> => {
  const { apiKey, apiUser } = validateConfig();
  const clientIp = await getClientIp();       // auto-detect or use .env value
  const apiUrl = buildNamecheapUrl();

  console.log(`[Namecheap] Checking ${domainList.length} domains with ClientIP: ${clientIp}`);

  // Namecheap allows max 50 domains per request
  const batch = domainList.slice(0, 50).join(',');

  const params = {
    ApiUser: apiUser,
    ApiKey: apiKey,
    UserName: apiUser,
    ClientIp: clientIp,
    Command: 'namecheap.domains.check',
    DomainList: batch,
  };

  let xmlResponse: string;
  try {
    const response = await axios.get(apiUrl, {
      params,
      timeout: 15000,
    });
    xmlResponse = response.data;
  } catch (err: any) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      `Namecheap API request failed: ${err.message}`,
    );
  }

  // ─── Parse XML Response ───
  let parsed: any;
  try {
    parsed = await parseStringPromise(xmlResponse, {
      explicitArray: false,
      ignoreAttrs: false,
      mergeAttrs: true,
    });
  } catch {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Failed to parse Namecheap API response');
  }

  // ─── Check API-level errors ───
  const apiResponse = parsed?.ApiResponse;
  if (!apiResponse) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Invalid Namecheap API response structure');
  }

  if (apiResponse.Status === 'ERROR') {
    const errors = apiResponse.Errors?.Error;
    const errorMsg = Array.isArray(errors)
      ? errors.map((e: any) => e._ || e).join(', ')
      : errors?._ || errors || 'Unknown API error';

    // Helpful hint for ClientIP error
    const detailMsg = typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('clientip')
      ? `${errorMsg}. → The IP "${clientIp}" must be whitelisted in your Namecheap account: Dashboard → Profile → Tools → Business & Dev Tools → API Access → Whitelisted IPs.`
      : errorMsg;

    throw new AppError(httpStatus.BAD_GATEWAY, `Namecheap API Error: ${detailMsg}`);
  }

  // ─── Extract DomainCheckResult ───
  const commandResponse = apiResponse.CommandResponse;
  if (!commandResponse) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'No CommandResponse in Namecheap API response');
  }

  let results = commandResponse.DomainCheckResult;
  if (!results) return [];

  // Normalize: xml2js returns object (not array) when only one result
  if (!Array.isArray(results)) results = [results];

  return results.map((item: any) => ({
    domain: item.Domain,
    available: item.Available === 'true',
    isPremium: item.IsPremiumName === 'true',
    premiumPrice: item.IsPremiumName === 'true' ? parseFloat(item.PremiumRegistrationPrice || '0') : undefined,
    icannFee: parseFloat(item.IcannFee || '0'),
    errorNo: item.ErrorNo || '0',
  }));
};

// ─── Types ───
export interface DomainCheckResult {
  domain: string;
  available: boolean;
  isPremium: boolean;
  premiumPrice?: number;
  icannFee: number;
  errorNo: string;
}

export interface DomainSearchResponse {
  query: string;
  primaryResult: DomainCheckResult;
  suggestions: DomainCheckResult[];
  detectedIp?: string; // for debugging
}

// ─── Main Service Function ───
export const checkDomainAvailability = async (domainName: string): Promise<DomainSearchResponse> => {
  if (!domainName || typeof domainName !== 'string' || domainName.trim().length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Domain name is required.');
  }

  const { sld, tld } = parseDomain(domainName);

  if (!sld || sld.length < 1 || sld.length > 63) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Invalid domain name. Domain label must be 1–63 characters.');
  }

  // Validate SLD: alphanumeric + hyphens, no leading/trailing hyphen
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$|^[a-z0-9]$/.test(sld)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      'Invalid domain name. Only letters, numbers, and hyphens are allowed.',
    );
  }

  // ─── Build list to check ───
  const primaryDomain = tld ? `${sld}.${tld}` : `${sld}.com`;
  const suggestionDomains = SUGGESTION_TLDS
    .filter((t) => t !== (tld || 'com'))
    .map((t) => `${sld}.${t}`);

  const allDomainsToCheck = [primaryDomain, ...suggestionDomains].slice(0, 50);

  // ─── Call Namecheap ───
  const results = await callNamecheapCheck(allDomainsToCheck);

  const primaryResult = results.find(
    (r) => r.domain.toLowerCase() === primaryDomain.toLowerCase(),
  );
  if (!primaryResult) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'Primary domain result not found in API response');
  }

  const suggestions = results.filter(
    (r) => r.domain.toLowerCase() !== primaryDomain.toLowerCase(),
  );

  return {
    query: domainName.trim(),
    primaryResult,
    suggestions,
  };
};
