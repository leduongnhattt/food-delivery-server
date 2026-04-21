import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@infra/prisma/prisma.service';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { ORDER_CANCEL_REASON } from '@common/constants/order-payment-status.constants';
import { deleteKey } from '@infra/redis/redis.service';

function getAcceptTimeoutMinutes(): number {
  const raw = process.env.ORDER_ACCEPT_TIMEOUT_MINUTES;
  const n = raw ? Number(raw) : 30;
  if (!Number.isFinite(n) || n <= 0) return 30;
  return n;
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function enterpriseCacheKeys(enterpriseId: string) {
  return {
    orders: `enterprise:${enterpriseId}:orders:v4`,
    recent: `enterprise:${enterpriseId}:recent_orders:v4`,
    stats: `enterprise:${enterpriseId}:stats`,
    revenue: `enterprise:${enterpriseId}:revenue`,
  } as const;
}

@Injectable()
export class OrderAcceptanceTimeoutJob {
  private readonly logger = new Logger(OrderAcceptanceTimeoutJob.name);

  constructor(private readonly prisma: PrismaService) { }

  /**
   * Auto-cancel orders when enterprise does not accept within SLA.
   *
   * - COD: Pending + latest PaymentMethod=Cash and OrderDate older than cutoff -> Cancelled
   * - Online: Pending + latest PaymentStatus=Completed and PaymentMethod!=Cash and OrderDate older than cutoff ->
   *   Cancelled + mark refundPending (refund implemented later)
   *
   * Runs every minute to keep UI close to real-time.
   */
  @Cron('*/1 * * * *')
  async runEveryMinute(): Promise<void> {
    const now = Date.now();
    const cutoff = new Date(now - getAcceptTimeoutMinutes() * 60 * 1000);

    const { cancelledCount, cancelledPaidCount } = await this.cancelPendingOlderThan(cutoff);

    if (cancelledCount > 0) {
      this.logger.log(
        `Auto-cancelled orders (total=${cancelledCount}, withRefundPending=${cancelledPaidCount}, cutoff=${cutoff.toISOString()})`,
      );
    }
  }

  private async cancelPendingOlderThan(
    cutoff: Date,
  ): Promise<{ cancelledCount: number; cancelledPaidCount: number }> {
    // We intentionally do NOT require a Payment row to exist.
    // Many COD orders will have no PAYMENT until completion; we still need to timeout them.
    const rows = await this.prisma.order.findMany({
      where: {
        Status: OrderStatus.Pending,
        OrderDate: { lte: cutoff },
      },
      select: {
        OrderID: true,
        Metadata: true,
        payments: {
          orderBy: { PaymentDate: 'desc' },
          take: 1,
          select: { PaymentMethod: true, PaymentStatus: true },
        },
      },
      take: 500,
    });

    let cancelled = 0;
    let cancelledPaid = 0;

    for (const row of rows) {
      const latestPayment = row.payments[0];
      const isOnlinePaid =
        !!latestPayment &&
        latestPayment.PaymentStatus === PaymentStatus.Completed &&
        latestPayment.PaymentMethod !== PaymentMethod.Cash;

      const base = asPlainObject(row.Metadata);
      const nextMeta = {
        ...base,
        cancelReason: ORDER_CANCEL_REASON.AcceptTimeout,
        cancelledAt: new Date().toISOString(),
        ...(isOnlinePaid
          ? {
              refundPending: true,
              refundReason: ORDER_CANCEL_REASON.AcceptTimeout,
            }
          : {}),
      };

      const res = await this.prisma.order.updateMany({
        where: { OrderID: row.OrderID, Status: OrderStatus.Pending, OrderDate: { lte: cutoff } },
        data: { Status: OrderStatus.Cancelled, Metadata: nextMeta },
      });

      if (res.count > 0) {
        cancelled += res.count;
        if (isOnlinePaid) cancelledPaid += res.count;
        await this.invalidateEnterpriseCachesForOrder(row.OrderID);
      }
    }

    return { cancelledCount: cancelled, cancelledPaidCount: cancelledPaid };
  }

  private async invalidateEnterpriseCachesForOrder(orderId: string): Promise<void> {
    // Best-effort cache invalidation; orders list cache is per-enterprise.
    const enterpriseIds = await this.prisma.orderDetail.findMany({
      where: { OrderID: orderId },
      select: { food: { select: { EnterpriseID: true } } },
    });

    const uniq = Array.from(
      new Set(
        enterpriseIds
          .map((r) => r.food?.EnterpriseID)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    );

    await Promise.all(
      uniq.flatMap((eid) => {
        const keys = enterpriseCacheKeys(eid);
        return [deleteKey(keys.orders), deleteKey(keys.recent), deleteKey(keys.stats), deleteKey(keys.revenue)];
      }),
    );
  }
}

