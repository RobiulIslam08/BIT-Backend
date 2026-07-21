// ============================================
// BIT SOFTWARE — Domain Pricing Service
// ============================================
// Single source of truth for domain sell prices.
// Admin CRUD + public read + in-memory cache for hot paths.

import mongoose from 'mongoose';
import httpStatus from 'http-status';
import AppError from '../../errors/AppError';
import { DomainPricing } from './domainPricing.model';
import {
  DEFAULT_DOMAIN_PRICING,
  FALLBACK_REGISTER_PRICE_USD,
  IDomainPricing,
} from './domainPricing.interface';
import { getRenewPriceUSD, peekCachedRenewPriceUSD } from '../../utils/namecheap';

// ─── In-memory cache (register prices by TLD) ───
let priceCache: Map<string, number> | null = null;
let priceCacheAt = 0;
const PRICE_CACHE_MS = 5 * 60 * 1000; // 5 minutes

const invalidateCache = () => {
  priceCache = null;
  priceCacheAt = 0;
};

const normalizeTld = (tld: string): string =>
  String(tld || '').replace(/^\./, '').toLowerCase().trim();

/**
 * Live renew price from the registrar (Namecheap), per TLD.
 * Never ask admin to maintain this — it is the source of truth for renewals.
 */
const attachLiveRenewPrices = async <T extends { tld: string; renewPriceUSD?: number }>(
  rows: T[],
): Promise<Array<T & { renewPriceUSD: number; renewPriceSource: 'provider' | 'fallback' }>> => {
  return Promise.all(
    rows.map(async (row) => {
      const live = await getRenewPriceUSD(row.tld);
      if (live && live > 0) {
        return {
          ...row,
          renewPriceUSD: parseFloat(live.toFixed(2)),
          renewPriceSource: 'provider' as const,
        };
      }
      // Soft fallback only if registrar API is unavailable
      const fallback =
        typeof row.renewPriceUSD === 'number' && row.renewPriceUSD > 0
          ? row.renewPriceUSD
          : FALLBACK_REGISTER_PRICE_USD;
      return {
        ...row,
        renewPriceUSD: fallback,
        renewPriceSource: 'fallback' as const,
      };
    }),
  );
};

/**
 * Seed default TLD prices if the collection is empty.
 * Idempotent — safe to call on every startup / first read.
 */
export const seedDomainPricingIfEmpty = async (): Promise<number> => {
  const count = await DomainPricing.countDocuments();
  if (count > 0) return 0;

  await DomainPricing.insertMany(
    DEFAULT_DOMAIN_PRICING.map((p) => ({
      ...p,
      isActive: true,
    })),
    { ordered: false },
  );
  invalidateCache();
  console.log(`[DomainPricing] Seeded ${DEFAULT_DOMAIN_PRICING.length} default TLD prices.`);
  return DEFAULT_DOMAIN_PRICING.length;
};

const loadRegisterPriceCache = async (): Promise<Map<string, number>> => {
  const now = Date.now();
  if (priceCache && now - priceCacheAt < PRICE_CACHE_MS) return priceCache;

  await seedDomainPricingIfEmpty();

  const rows = await DomainPricing.find({ isActive: true })
    .select('tld registerPriceUSD')
    .lean();

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.tld, row.registerPriceUSD);
  }
  priceCache = map;
  priceCacheAt = now;
  return map;
};

/**
 * Resolve the customer sell (register) price for a TLD.
 * Used by domain purchase flow. Falls back to $20 if TLD unknown.
 */
export const getDomainPriceUSD = async (tld: string): Promise<number> => {
  const key = normalizeTld(tld);
  if (!key) return FALLBACK_REGISTER_PRICE_USD;

  try {
    const cache = await loadRegisterPriceCache();
    const price = cache.get(key);
    if (typeof price === 'number' && price >= 0) return price;
  } catch (err) {
    console.error('[DomainPricing] Cache/DB lookup failed, using fallback:', (err as Error).message);
  }
  return FALLBACK_REGISTER_PRICE_USD;
};

// ─── Public (active prices for website) ───
// Register = admin sell price (DB). Renew = registrar when cached, else DB snapshot.
// IMPORTANT: Never block this endpoint on live Namecheap calls — the public
// website axios client times out at 15s and would show empty / fallback prices.

/** Warm renew cache + persist snapshots without delaying the HTTP response.
 *  Only fetches TLDs that are not already in the in-memory cache. */
const refreshRenewSnapshotsInBackground = (tlds: string[]) => {
  const missing = tlds.filter((tld) => peekCachedRenewPriceUSD(tld) == null);
  if (!missing.length) return;

  void (async () => {
    await Promise.all(
      missing.map(async (tld) => {
        try {
          const live = await getRenewPriceUSD(tld);
          if (live && live > 0) {
            await DomainPricing.updateOne(
              { tld },
              { $set: { renewPriceUSD: parseFloat(live.toFixed(2)) } },
            );
          }
        } catch {
          // Background only — ignore failures
        }
      }),
    );
  })();
};

export const getPublicPricing = async () => {
  await seedDomainPricingIfEmpty();
  const rows = await DomainPricing.find({ isActive: true })
    .select('tld registerPriceUSD renewPriceUSD transferPriceUSD')
    .sort({ tld: 1 })
    .lean();

  const payload = rows.map((r) => {
    const cached = peekCachedRenewPriceUSD(r.tld);
    const renewFromCache = cached && cached > 0 ? cached : null;
    const renewFromDb =
      typeof r.renewPriceUSD === 'number' && r.renewPriceUSD > 0
        ? r.renewPriceUSD
        : null;
    const renewPriceUSD =
      renewFromCache ?? renewFromDb ?? r.registerPriceUSD;

    return {
      tld: r.tld,
      registerPriceUSD: r.registerPriceUSD,
      renewPriceUSD: parseFloat(Number(renewPriceUSD).toFixed(2)),
      transferPriceUSD: r.transferPriceUSD ?? r.registerPriceUSD,
      renewPriceSource: renewFromCache ? ('provider' as const) : ('fallback' as const),
    };
  });

  refreshRenewSnapshotsInBackground(rows.map((r) => r.tld));
  return payload;
};

// ─── Admin CRUD ───

export const getAllPricing = async (query: Record<string, unknown> = {}) => {
  await seedDomainPricingIfEmpty();

  const filter: Record<string, unknown> = {};
  if (query.isActive === 'true' || query.isActive === true) filter.isActive = true;
  if (query.isActive === 'false' || query.isActive === false) filter.isActive = false;
  if (query.search) {
    const term = normalizeTld(String(query.search));
    filter.tld = { $regex: term, $options: 'i' };
  }

  const rows = await DomainPricing.find(filter)
    .sort({ tld: 1 })
    .populate('updatedBy', 'name email')
    .lean();

  // Show live renew next to admin register prices (read-only for admin).
  return attachLiveRenewPrices(rows as Array<{ tld: string; renewPriceUSD?: number } & Record<string, unknown>>);
};

export const createPricing = async (
  adminId: string,
  payload: {
    tld: string;
    registerPriceUSD: number;
    transferPriceUSD?: number;
    isActive?: boolean;
    notes?: string;
  },
): Promise<IDomainPricing> => {
  const tld = normalizeTld(payload.tld);
  if (!tld) throw new AppError(httpStatus.BAD_REQUEST, 'TLD is required.');

  const existing = await DomainPricing.findOne({ tld });
  if (existing) {
    throw new AppError(httpStatus.CONFLICT, `Pricing for .${tld} already exists. Edit it instead.`);
  }

  const registerPriceUSD = payload.registerPriceUSD;
  // Renew is always from registrar — store a snapshot only as offline fallback.
  const liveRenew = await getRenewPriceUSD(tld);
  const renewPriceUSD =
    liveRenew && liveRenew > 0 ? parseFloat(liveRenew.toFixed(2)) : registerPriceUSD;
  const transferPriceUSD = payload.transferPriceUSD ?? registerPriceUSD;

  const created = await DomainPricing.create({
    tld,
    registerPriceUSD,
    renewPriceUSD,
    transferPriceUSD,
    isActive: payload.isActive ?? true,
    notes: payload.notes,
    updatedBy: new mongoose.Types.ObjectId(adminId),
  });

  invalidateCache();
  return created.toObject() as IDomainPricing;
};

export const updatePricing = async (
  id: string,
  adminId: string,
  payload: Partial<{
    registerPriceUSD: number;
    transferPriceUSD: number;
    isActive: boolean;
    notes: string | null;
  }>,
): Promise<IDomainPricing> => {
  const doc = await DomainPricing.findById(id);
  if (!doc) throw new AppError(httpStatus.NOT_FOUND, 'Pricing entry not found.');

  if (payload.registerPriceUSD !== undefined) doc.registerPriceUSD = payload.registerPriceUSD;
  // renewPriceUSD is NOT admin-editable — refresh snapshot from registrar when possible
  const liveRenew = await getRenewPriceUSD(doc.tld);
  if (liveRenew && liveRenew > 0) {
    doc.renewPriceUSD = parseFloat(liveRenew.toFixed(2));
  }
  if (payload.transferPriceUSD !== undefined) doc.transferPriceUSD = payload.transferPriceUSD;
  if (payload.isActive !== undefined) doc.isActive = payload.isActive;
  if (payload.notes !== undefined) doc.notes = payload.notes ?? undefined;
  doc.updatedBy = new mongoose.Types.ObjectId(adminId);

  await doc.save();
  invalidateCache();
  return doc.toObject() as IDomainPricing;
};

export const deletePricing = async (id: string) => {
  const doc = await DomainPricing.findByIdAndDelete(id);
  if (!doc) throw new AppError(httpStatus.NOT_FOUND, 'Pricing entry not found.');
  invalidateCache();
  return { deleted: true, tld: doc.tld };
};

/**
 * Upsert many TLD register prices in one request.
 * Renew is always pulled live from the registrar (not admin-supplied).
 */
export const bulkUpsertPricing = async (
  adminId: string,
  items: Array<{
    tld: string;
    registerPriceUSD: number;
    transferPriceUSD?: number;
    isActive?: boolean;
  }>,
) => {
  const adminOid = new mongoose.Types.ObjectId(adminId);
  let upserted = 0;

  for (const item of items) {
    const tld = normalizeTld(item.tld);
    if (!tld) continue;
    const registerPriceUSD = item.registerPriceUSD;
    const liveRenew = await getRenewPriceUSD(tld);
    const renewPriceUSD =
      liveRenew && liveRenew > 0 ? parseFloat(liveRenew.toFixed(2)) : registerPriceUSD;
    const transferPriceUSD = item.transferPriceUSD ?? registerPriceUSD;

    await DomainPricing.updateOne(
      { tld },
      {
        $set: {
          registerPriceUSD,
          renewPriceUSD,
          transferPriceUSD,
          isActive: item.isActive ?? true,
          updatedBy: adminOid,
        },
        $setOnInsert: { tld },
      },
      { upsert: true },
    );
    upserted += 1;
  }

  invalidateCache();
  return { upserted };
};
