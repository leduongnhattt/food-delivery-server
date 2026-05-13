/**
 * Discount from voucher row (percent vs fixed amount, min order on subtotal).
 * If DiscountPercent > 0, percent wins; else fixed DiscountAmount.
 */
export function computeVoucherDiscountFromRow(params: {
  subtotal: number;
  discountPercent: number | null;
  discountAmount: number | null;
  minOrderValue: number | null;
}): number {
  const sub = Math.max(0, Number(params.subtotal) || 0);
  const min =
    params.minOrderValue != null && Number.isFinite(Number(params.minOrderValue))
      ? Math.max(0, Number(params.minOrderValue))
      : 0;
  if (min > 0 && sub < min) return 0;

  const pct =
    params.discountPercent != null && Number.isFinite(Number(params.discountPercent))
      ? Number(params.discountPercent)
      : 0;
  const amt =
    params.discountAmount != null && Number.isFinite(Number(params.discountAmount))
      ? Number(params.discountAmount)
      : 0;

  if (pct > 0) {
    const raw = sub * (pct / 100);
    return Math.round(Math.min(sub, raw) * 100) / 100;
  }
  if (amt > 0) {
    return Math.round(Math.min(sub, amt) * 100) / 100;
  }
  return 0;
}
