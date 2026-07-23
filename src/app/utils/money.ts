// ============================================
// BIT SOFTWARE — Money Utility (USD, cent-safe)
// ============================================
// All wallet balances are stored as USD Numbers to stay consistent with the
// rest of the pricing code (sellPriceUSD etc.). To avoid floating-point drift
// (e.g. 0.1 + 0.2 !== 0.3), every arithmetic operation is done in integer
// "cents" and converted back to a 2-decimal USD number.

/** Convert a USD amount to integer cents (rounded). */
export const toCents = (usd: number): number => Math.round((Number(usd) || 0) * 100);

/** Convert integer cents back to a 2-decimal USD number. */
export const fromCents = (cents: number): number => Number((Math.round(cents) / 100).toFixed(2));

/** Round any USD amount to a safe 2-decimal value. */
export const roundMoney = (usd: number): number => fromCents(toCents(usd));

/** a + b (cent-safe). */
export const addMoney = (a: number, b: number): number => fromCents(toCents(a) + toCents(b));

/** a - b (cent-safe). */
export const subtractMoney = (a: number, b: number): number => fromCents(toCents(a) - toCents(b));

/** Smaller of two USD amounts (cent-safe). */
export const minMoney = (a: number, b: number): number =>
  toCents(a) <= toCents(b) ? roundMoney(a) : roundMoney(b);

/** a >= b comparison performed on cents (avoids float edge cases). */
export const gteMoney = (a: number, b: number): boolean => toCents(a) >= toCents(b);

/** a > b comparison performed on cents. */
export const gtMoney = (a: number, b: number): boolean => toCents(a) > toCents(b);

/**
 * The whole-unit (integer USD) portion of a balance — used for withdrawals.
 * e.g. 100.65 -> 100. The fractional remainder can never be withdrawn.
 */
export const wholeUnits = (usd: number): number => Math.floor(toCents(usd) / 100);

/** True when the amount is a positive whole USD number (no fractional cents). */
export const isWholeAmount = (usd: number): boolean => {
  const cents = toCents(usd);
  return cents > 0 && cents % 100 === 0;
};
