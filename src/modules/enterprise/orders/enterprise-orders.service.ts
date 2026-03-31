import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { deleteKey, getKeyJson, setKeyJson } from '@infra/redis/redis.service';

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
  orderDetails: Array<{
    dishName: string;
    quantity: number;
    subTotal: number;
  }>;
}

interface OrdersCachePayload {
  orders: EnterpriseCachedOrder[];
  lastUpdated: string;
  totalCount: number;
}

const CACHE_KEYS = {
  orders: (enterpriseId: string) => `enterprise:${enterpriseId}:orders`,
  recent: (enterpriseId: string) => `enterprise:${enterpriseId}:recent_orders`,
  stats: (enterpriseId: string) => `enterprise:${enterpriseId}:stats`,
  revenue: (enterpriseId: string) => `enterprise:${enterpriseId}:revenue`,
} as const;

const TTL_SECONDS = {
  orders: 5 * 60,
  recent: 2 * 60,
} as const;

@Injectable()
export class EnterpriseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private async getEnterpriseIdByAccountId(accountId: string): Promise<string> {
    const enterprise = await this.prisma.enterprise.findUnique({
      where: { AccountID: accountId },
      select: { EnterpriseID: true },
    });
    if (!enterprise) throw new NotFoundException('Enterprise not found');
    return enterprise.EnterpriseID;
  }

  private formatOrderRows(rows: Array<any>): EnterpriseCachedOrder[] {
    return rows.map((order) => ({
      id: order.OrderID,
      customerName:
        order.customer?.FullName ||
        order.customer?.account?.Username ||
        'Unknown Customer',
      customerUsername: order.customer?.account?.Username || null,
      totalAmount: Number(order.TotalAmount),
      status: order.Status,
      createdAt: order.OrderDate.toISOString(),
      items: order.orderDetails.reduce(
        (sum: number, d: any) => sum + d.Quantity,
        0,
      ),
      deliveryAddress: order.DeliveryAddress,
      phoneNumber: order.customer?.PhoneNumber || null,
      customerAddress: order.customer?.Address || null,
      orderDetails: order.orderDetails.map((d: any) => ({
        dishName: d.food.DishName,
        quantity: d.Quantity,
        subTotal: Number(d.SubTotal),
      })),
    }));
  }

  async list(accountId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const cached = await getKeyJson<OrdersCachePayload>(CACHE_KEYS.orders(enterpriseId));
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
      include: {
        customer: {
          select: {
            FullName: true,
            PhoneNumber: true,
            Address: true,
            account: { select: { Username: true } },
          },
        },
        orderDetails: {
          select: {
            Quantity: true,
            SubTotal: true,
            food: { select: { DishName: true } },
          },
        },
      },
      orderBy: { OrderDate: 'desc' },
    });

    const orders = this.formatOrderRows(rows);
    const payload: OrdersCachePayload = {
      orders,
      totalCount: orders.length,
      lastUpdated: new Date().toISOString(),
    };
    await setKeyJson(CACHE_KEYS.orders(enterpriseId), payload, TTL_SECONDS.orders);
    await setKeyJson(CACHE_KEYS.recent(enterpriseId), orders.slice(0, 10), TTL_SECONDS.recent);

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

    const cached = await getKeyJson<EnterpriseCachedOrder[]>(CACHE_KEYS.recent(enterpriseId));
    if (cached) {
      return { success: true, orders: cached, fromCache: true };
    }

    const rows = await this.prisma.order.findMany({
      where: {
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
            account: { select: { Username: true } },
          },
        },
        orderDetails: {
          select: {
            Quantity: true,
            SubTotal: true,
            food: { select: { DishName: true } },
          },
        },
      },
      orderBy: { OrderDate: 'desc' },
      take: 10,
    });

    const orders = this.formatOrderRows(rows);
    await setKeyJson(CACHE_KEYS.recent(enterpriseId), orders, TTL_SECONDS.recent);
    return { success: true, orders, fromCache: false };
  }

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
      select: { OrderID: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found or access denied');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.settlementItem.deleteMany({ where: { OrderID: orderId } });
      await tx.payment.deleteMany({ where: { OrderID: orderId } });
      await tx.orderDetail.deleteMany({ where: { OrderID: orderId } });
      await tx.order.delete({ where: { OrderID: orderId } });
    });

    await Promise.all([
      deleteKey(CACHE_KEYS.orders(enterpriseId)),
      deleteKey(CACHE_KEYS.recent(enterpriseId)),
      deleteKey(CACHE_KEYS.stats(enterpriseId)),
      deleteKey(CACHE_KEYS.revenue(enterpriseId)),
    ]);

    return { success: true, message: 'Order deleted successfully' };
  }
}

