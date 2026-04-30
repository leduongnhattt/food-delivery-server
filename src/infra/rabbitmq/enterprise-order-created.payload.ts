/**
 * JSON payload for orders.enterprise.created (queue message).
 * Designed for idempotent consumption (EventID is unique).
 */
export type EnterpriseOrderCreatedPayload = {
  eventId: string;
  orderId: string;
  enterpriseId: string;
  createdAt: string;
  customerName?: string;
  totalAmount?: number;
};

