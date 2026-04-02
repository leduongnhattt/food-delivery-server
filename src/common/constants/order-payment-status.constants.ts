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

