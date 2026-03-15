/**
 * Per-item order value limits. Align with food-delivery-app src/lib/order-limit.ts.
 * SubTotal (unitPrice * quantity) must not exceed this for a single line item.
 */
export const ITEM_ORDER_VALUE_LIMIT_USD = 100;
export const ITEM_ORDER_VALUE_LIMIT_VND = 1_000_000;

/** Default currency for server validation (Stripe/pricing). */
export const ITEM_ORDER_VALUE_LIMIT = ITEM_ORDER_VALUE_LIMIT_USD;
