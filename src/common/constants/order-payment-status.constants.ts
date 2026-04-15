import { OrderStatus, PaymentStatus } from '@prisma/client';

export const ORDER_STATUS = {
  Pending: OrderStatus.Pending,
  Confirmed: OrderStatus.Confirmed,
  Preparing: OrderStatus.Preparing,
  ReadyForPickup: OrderStatus.ReadyForPickup,
  OutForDelivery: OrderStatus.OutForDelivery,
  Delivered: OrderStatus.Delivered,
  Completed: OrderStatus.Completed,
  Cancelled: OrderStatus.Cancelled,
  Refunded: OrderStatus.Refunded,
} as const;

export const PAYMENT_STATUS = {
  Pending: PaymentStatus.Pending,
  Completed: PaymentStatus.Completed,
  Failed: PaymentStatus.Failed,
} as const;

export const ORDER_CANCEL_REASON = {
  AcceptTimeout: 'accept_timeout',
  EnterpriseCancelled: 'enterprise_cancelled',
  CustomerCancelled: 'customer_cancelled',
  PaymentFailed: 'payment_failed',
} as const;

