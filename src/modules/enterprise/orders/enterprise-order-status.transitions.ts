import { OrderStatus } from '@prisma/client';

/**
 * Allowed enterprise-driven order status transitions (kitchen ops + cancel before cooking).
 */
export const ENTERPRISE_ALLOWED_TRANSITIONS: ReadonlyMap<
  OrderStatus,
  readonly OrderStatus[]
> = new Map([
  [OrderStatus.Pending, [OrderStatus.Confirmed, OrderStatus.Cancelled]],
  [OrderStatus.Confirmed, [OrderStatus.Preparing, OrderStatus.Cancelled]],
  [OrderStatus.Preparing, [OrderStatus.ReadyForPickup, OrderStatus.OutForDelivery, OrderStatus.Cancelled]],
  [OrderStatus.OutForDelivery, [OrderStatus.Delivered]],
  [OrderStatus.ReadyForPickup, []],
]);

export function isEnterpriseTransitionAllowed(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  const allowed = ENTERPRISE_ALLOWED_TRANSITIONS.get(from);
  return allowed ? allowed.includes(to) : false;
}
