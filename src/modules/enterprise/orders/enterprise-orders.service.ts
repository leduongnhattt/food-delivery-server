import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { deleteKey, getKeyJson, setKeyJson } from '@infra/redis/redis.service';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { ORDER_STATUS } from '@common/constants/order-payment-status.constants';
import { isEnterpriseTransitionAllowed } from '@modules/enterprise/orders/enterprise-order-status.transitions';

function isJsonObject(v: unknown): v is Prisma.JsonObject {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

type EnterpriseStatusHistoryEntry = {
  status: string;
  at: string;
  actor?: string;
};

function parseEnterpriseStatusHistory(
  raw: unknown,
): EnterpriseStatusHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: EnterpriseStatusHistoryEntry[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const status = typeof o.status === 'string' ? o.status : '';
    const at = typeof o.at === 'string' ? o.at : '';
    if (!status || !at) continue;
    const actor = typeof o.actor === 'string' ? o.actor : undefined;
    out.push(actor ? { status, at, actor } : { status, at });
  }
  return out;
}

const ordersInclude = {
  customer: {
    select: {
      FullName: true,
      PhoneNumber: true,
      Address: true,
      account: { select: { Username: true } },
    },
  },
  returnRequest: {
    select: {
      ReturnRequestID: true,
      Status: true,
    },
  },
  orderDetails: {
    select: {
      Quantity: true,
      SubTotal: true,
      food: { select: { DishName: true, ImageURL: true } },
    },
  },
  payments: {
    orderBy: { PaymentDate: 'desc' as const },
    take: 1,
    select: {
      PaymentID: true,
      PaymentStatus: true,
      PaymentMethod: true,
      PaymentDate: true,
      TransactionID: true,
    },
  },
} as const satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ordersInclude }>;

export interface EnterpriseCachedOrder {
  id: string;
  customerName: string;
  customerUsername: string | null;
  totalAmount: number;
  status: string;
  createdAt: string;
  items: number;
  deliveryAddress: string;
  phoneNumber: string | null;
  customerAddress: string | null;
  metadata?: unknown;
  orderDetails: Array<{
    dishName: string;
    quantity: number;
    subTotal: number;
    /** Product image for list row thumbnail (optional). */
    imageUrl: string | null;
  }>;
  /** SLA-style ship-by time for list UI (optional). */
  estimatedDeliveryTime: string | null;
  /** Latest payment (for Unpaid tab / badges). */
  paymentId: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
}

interface OrdersCachePayload {
  orders: EnterpriseCachedOrder[];
  lastUpdated: string;
  totalCount: number;
}

const CACHE_KEYS = {
  orders: (enterpriseId: string) => `enterprise:${enterpriseId}:orders:v3`,
  recent: (enterpriseId: string) =>
    `enterprise:${enterpriseId}:recent_orders:v3`,
  stats: (enterpriseId: string) => `enterprise:${enterpriseId}:stats`,
  revenue: (enterpriseId: string) => `enterprise:${enterpriseId}:revenue`,
} as const;

const TTL_SECONDS = {
  orders: 5 * 60,
  recent: 2 * 60,
} as const;

const ENTERPRISE_SETTABLE_STATUSES: OrderStatus[] = [
  OrderStatus.Confirmed,
  OrderStatus.Preparing,
  OrderStatus.ReadyForPickup,
  OrderStatus.OutForDelivery,
  OrderStatus.Delivered,
  OrderStatus.Cancelled,
];

@Injectable()
export class EnterpriseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private parseDeliveryMethod(body: {
    deliveryMethod?: unknown;
  }): 'SelfDelivery' | 'ThirdParty' {
    const raw = body?.deliveryMethod;
    if (typeof raw !== 'string') {
      throw new BadRequestException('deliveryMethod is required');
    }
    const v = raw.trim();
    if (v !== 'SelfDelivery' && v !== 'ThirdParty') {
      throw new BadRequestException(`Invalid deliveryMethod: ${raw}`);
    }
    return v;
  }

  private async getEnterpriseIdByAccountId(accountId: string): Promise<string> {
    const enterprise = await this.prisma.enterprise.findFirst({
      where: { AccountID: accountId, DeletedAt: null },
      select: { EnterpriseID: true },
    });
    if (!enterprise) throw new NotFoundException('Enterprise not found');
    return enterprise.EnterpriseID;
  }

  private async invalidateEnterpriseCaches(
    enterpriseId: string,
  ): Promise<void> {
    await Promise.all([
      deleteKey(CACHE_KEYS.orders(enterpriseId)),
      deleteKey(CACHE_KEYS.recent(enterpriseId)),
      deleteKey(CACHE_KEYS.stats(enterpriseId)),
      deleteKey(CACHE_KEYS.revenue(enterpriseId)),
    ]);
  }

  private formatOrderRows(rows: OrderRow[]): EnterpriseCachedOrder[] {
    return rows.map((order) => {
      const latest = order.payments[0];
      const baseMeta =
        order.Metadata && isJsonObject(order.Metadata) ? order.Metadata : {};
      const metaReturnIdRaw = baseMeta['returnRequestId'];
      const hasMetaReturnId =
        typeof metaReturnIdRaw === 'string' &&
        metaReturnIdRaw.trim().length > 0;
      const rrId = hasMetaReturnId
        ? metaReturnIdRaw.trim()
        : (order.returnRequest?.ReturnRequestID ?? null);
      const mergedMeta =
        rrId && !hasMetaReturnId
          ? ({ ...baseMeta, returnRequestId: rrId } as Prisma.JsonObject)
          : baseMeta;
      return {
        id: order.OrderID,
        customerName:
          order.customer?.FullName ||
          order.customer?.account?.Username ||
          'Unknown Customer',
        customerUsername: order.customer?.account?.Username || null,
        totalAmount: Number(order.TotalAmount),
        status: order.Status,
        createdAt: order.OrderDate.toISOString(),
        items: order.orderDetails.reduce((sum, d) => sum + d.Quantity, 0),
        deliveryAddress: order.DeliveryAddress,
        phoneNumber: order.customer?.PhoneNumber || null,
        customerAddress: order.customer?.Address || null,
        orderDetails: order.orderDetails.map((d) => ({
          dishName: d.food.DishName,
          quantity: d.Quantity,
          subTotal: Number(d.SubTotal),
          imageUrl: d.food.ImageURL ?? null,
        })),
        estimatedDeliveryTime:
          order.EstimatedDeliveryTime?.toISOString() ?? null,
        metadata: Object.keys(mergedMeta).length
          ? mergedMeta
          : (order.Metadata ?? null),
        paymentId: latest?.PaymentID ?? null,
        paymentStatus: latest?.PaymentStatus ?? null,
        paymentMethod: latest?.PaymentMethod ?? null,
      };
    });
  }

  async list(accountId: string, opts?: { force?: boolean }) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const cached = opts?.force
      ? null
      : await getKeyJson<OrdersCachePayload>(CACHE_KEYS.orders(enterpriseId));
    if (cached) {
      return {
        success: true,
        orders: cached.orders,
        totalCount: cached.totalCount,
        lastUpdated: cached.lastUpdated,
        fromCache: true,
      };
    }

    const rows = await this.prisma.order.findMany({
      where: {
        orderDetails: {
          some: { food: { EnterpriseID: enterpriseId } },
        },
      },
      include: ordersInclude,
      orderBy: { OrderDate: 'desc' },
    });

    const orders = this.formatOrderRows(rows);
    const payload: OrdersCachePayload = {
      orders,
      totalCount: orders.length,
      lastUpdated: new Date().toISOString(),
    };
    await setKeyJson(
      CACHE_KEYS.orders(enterpriseId),
      payload,
      TTL_SECONDS.orders,
    );
    await setKeyJson(
      CACHE_KEYS.recent(enterpriseId),
      orders.slice(0, 10),
      TTL_SECONDS.recent,
    );

    return {
      success: true,
      orders,
      totalCount: orders.length,
      lastUpdated: payload.lastUpdated,
      fromCache: false,
    };
  }

  async recent(accountId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const cached = await getKeyJson<EnterpriseCachedOrder[]>(
      CACHE_KEYS.recent(enterpriseId),
    );
    if (cached) {
      return { success: true, orders: cached, fromCache: true };
    }

    const rows = await this.prisma.order.findMany({
      where: {
        orderDetails: {
          some: { food: { EnterpriseID: enterpriseId } },
        },
      },
      include: ordersInclude,
      orderBy: { OrderDate: 'desc' },
      take: 10,
    });

    const orders = this.formatOrderRows(rows);
    await setKeyJson(
      CACHE_KEYS.recent(enterpriseId),
      orders,
      TTL_SECONDS.recent,
    );
    return { success: true, orders, fromCache: false };
  }

  /**
   * Full order detail for enterprise dashboard (My Order detail screen).
   */
  async getById(accountId: string, orderId: string) {
    if (!orderId?.trim()) {
      throw new BadRequestException('Order id is required');
    }
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const order = await this.prisma.order.findFirst({
      where: {
        OrderID: orderId,
        orderDetails: {
          some: { food: { EnterpriseID: enterpriseId } },
        },
      },
      include: {
        customer: {
          select: {
            FullName: true,
            PhoneNumber: true,
            Address: true,
            account: { select: { Username: true, Email: true } },
          },
        },
        orderDetails: {
          include: {
            food: {
              select: {
                FoodID: true,
                DishName: true,
                Price: true,
                ImageURL: true,
              },
            },
          },
        },
        payments: {
          orderBy: { PaymentDate: 'desc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found or access denied');
    }

    return {
      success: true,
      order: {
        orderId: order.OrderID,
        status: order.Status,
        totalAmount: Number(order.TotalAmount),
        orderDate: order.OrderDate.toISOString(),
        deliveryAddress: order.DeliveryAddress,
        deliveryNote: order.DeliveryNote ?? '',
        estimatedDeliveryTime:
          order.EstimatedDeliveryTime?.toISOString() ?? null,
        deliveredAt: order.DeliveredAt?.toISOString() ?? null,
        commissionAmount:
          order.CommissionAmount != null
            ? Number(order.CommissionAmount)
            : null,
        metadata: order.Metadata,
        customer: {
          fullName: order.customer?.FullName ?? null,
          username: order.customer?.account?.Username ?? null,
          email: order.customer?.account?.Email ?? null,
          phoneNumber: order.customer?.PhoneNumber ?? null,
          address: order.customer?.Address ?? null,
        },
        orderDetails: order.orderDetails.map((d) => ({
          orderDetailId: d.OrderDetailID,
          foodId: d.FoodID,
          dishName: d.food.DishName,
          unitPrice: Number(d.food.Price),
          quantity: d.Quantity,
          subTotal: Number(d.SubTotal),
          imageUrl: d.food.ImageURL,
        })),
        payments: order.payments.map((p) => ({
          paymentId: p.PaymentID,
          status: p.PaymentStatus,
          method: p.PaymentMethod,
          paymentDate: p.PaymentDate.toISOString(),
          transactionId: p.TransactionID,
        })),
      },
    };
  }

  private parseTargetStatus(body: { status?: unknown }): OrderStatus {
    const raw = body?.status;
    if (typeof raw !== 'string') {
      throw new BadRequestException('status is required');
    }
    const upper = raw.trim();
    if (!Object.values(OrderStatus).includes(upper as OrderStatus)) {
      throw new BadRequestException(`Invalid order status: ${raw}`);
    }
    return upper as OrderStatus;
  }

  /**
   * Enterprise updates order status (kitchen ops + cancel before shipping).
   */
  async updateStatus(
    accountId: string,
    orderId: string,
    body: { status?: unknown },
  ) {
    if (!orderId?.trim()) {
      throw new BadRequestException('Order id is required');
    }
    const target = this.parseTargetStatus(body);
    if (!ENTERPRISE_SETTABLE_STATUSES.includes(target)) {
      throw new BadRequestException(
        `Enterprise cannot set status to ${target}. Allowed: ${ENTERPRISE_SETTABLE_STATUSES.join(', ')}`,
      );
    }

    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: {
          OrderID: orderId,
          orderDetails: {
            some: { food: { EnterpriseID: enterpriseId } },
          },
        },
        select: {
          OrderID: true,
          Status: true,
          Metadata: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found or access denied');
      }

      if (order.Status === target) {
        return {
          orderId: order.OrderID,
          status: target,
          unchanged: true as const,
        };
      }

      if (!isEnterpriseTransitionAllowed(order.Status, target)) {
        throw new ConflictException(
          `Cannot transition from ${order.Status} to ${target}`,
        );
      }

      const baseMeta: Prisma.JsonObject = isJsonObject(order.Metadata)
        ? order.Metadata
        : {};

      const existingHistory = parseEnterpriseStatusHistory(
        baseMeta['statusHistory'],
      );
      const nextHistory: EnterpriseStatusHistoryEntry[] = [
        ...existingHistory,
        {
          status: String(target),
          at: new Date().toISOString(),
          actor: 'enterprise',
        },
      ];

      const nextMetaObj: Prisma.JsonObject = {
        ...baseMeta,
        statusHistory: nextHistory as unknown as Prisma.JsonValue,
      };
      // Cancellation timestamp is useful for customer timeline.
      if (
        target === ORDER_STATUS.Cancelled &&
        typeof nextMetaObj['cancelledAt'] !== 'string'
      ) {
        nextMetaObj['cancelledAt'] = new Date().toISOString();
      }
      const nextMeta: Prisma.InputJsonValue = nextMetaObj;

      const data: Prisma.OrderUpdateInput = {
        Status: target,
        Metadata: nextMeta,
      };
      if (target === ORDER_STATUS.Delivered) {
        data.DeliveredAt = new Date();
      }
      if (target === ORDER_STATUS.Cancelled) {
        await tx.payment.updateMany({
          where: {
            OrderID: orderId,
            PaymentStatus: PaymentStatus.Pending,
          },
          data: { PaymentStatus: PaymentStatus.Failed },
        });
      }

      await tx.order.update({
        where: { OrderID: orderId },
        data,
      });

      return {
        orderId: order.OrderID,
        status: target,
        unchanged: false as const,
      };
    });

    await this.invalidateEnterpriseCaches(enterpriseId);

    return {
      success: true,
      orderId: result.orderId,
      status: result.status,
      unchanged: result.unchanged,
    };
  }

  /**
   * Enterprise sets delivery method (stored in Order.Metadata) while order is in Confirmed/Preparing.
   */
  async updateDeliveryMethod(
    accountId: string,
    orderId: string,
    body: { deliveryMethod?: unknown },
  ) {
    if (!orderId?.trim()) {
      throw new BadRequestException('Order id is required');
    }
    const deliveryMethod = this.parseDeliveryMethod(body);
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: {
          OrderID: orderId,
          orderDetails: { some: { food: { EnterpriseID: enterpriseId } } },
        },
        select: { OrderID: true, Status: true, Metadata: true },
      });

      if (!order) {
        throw new NotFoundException('Order not found or access denied');
      }

      const allowedStatuses: OrderStatus[] = [
        OrderStatus.Confirmed,
        OrderStatus.Preparing,
      ];
      if (!allowedStatuses.includes(order.Status)) {
        throw new ConflictException(
          `Cannot set delivery method when status is ${order.Status}. Allowed: Confirmed, Preparing`,
        );
      }

      const base: Prisma.JsonObject = isJsonObject(order.Metadata)
        ? order.Metadata
        : {};

      const next: Prisma.InputJsonValue = {
        ...base,
        deliveryMethod,
      } as Prisma.InputJsonValue;

      await tx.order.update({
        where: { OrderID: orderId },
        data: { Metadata: next },
      });

      return { orderId: order.OrderID, deliveryMethod };
    });

    await this.invalidateEnterpriseCaches(enterpriseId);

    return { success: true, ...updated };
  }

  /**
   * Hard delete only allowed for unpaid pending orders (audit-friendly).
   */
  async delete(accountId: string, orderId: string) {
    if (!orderId) throw new BadRequestException('OrderId is required');

    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const order = await this.prisma.order.findFirst({
      where: {
        OrderID: orderId,
        orderDetails: {
          some: { food: { EnterpriseID: enterpriseId } },
        },
      },
      include: {
        payments: { orderBy: { PaymentDate: 'desc' }, take: 1 },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found or access denied');
    }

    if (order.Status !== OrderStatus.Pending) {
      throw new ConflictException(
        'Only pending orders can be deleted. Use status update to cancel confirmed orders.',
      );
    }

    const latest = order.payments[0];
    if (latest?.PaymentStatus === PaymentStatus.Completed) {
      throw new ConflictException(
        'Cannot delete an order with a completed payment. Use cancel instead.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.settlementItem.deleteMany({ where: { OrderID: orderId } });
      await tx.payment.deleteMany({ where: { OrderID: orderId } });
      await tx.orderDetail.deleteMany({ where: { OrderID: orderId } });
      await tx.order.delete({ where: { OrderID: orderId } });
    });

    await this.invalidateEnterpriseCaches(enterpriseId);

    return { success: true, message: 'Order deleted successfully' };
  }
}
