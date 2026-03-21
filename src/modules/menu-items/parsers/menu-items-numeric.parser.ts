/**
 * Shared numeric parsing for menu-item payloads (legacy parity with Next routes).
 */

export function parseRequiredPriceLegacy(
  value: number | string | undefined | null,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value === '') {
    return null;
  }
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Legacy create check: `if (!price)` rejects 0 — caller should use this only after presence check.
 */
export function isLegacyTruthyPrice(value: number | string | undefined | null): boolean {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  if (typeof value === 'number') {
    return value !== 0 && Number.isFinite(value);
  }
  const n = parseFloat(value);
  return n !== 0 && Number.isFinite(n);
}

/**
 * Legacy update: `price ? parseFloat(price) : undefined` — 0 and NaN skip the field.
 */
export function parseOptionalPriceForUpdate(
  value: number | string | undefined | null,
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n) || n === 0) {
    return undefined;
  }
  return n;
}
