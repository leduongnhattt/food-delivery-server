import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { OrderStatus, VoucherStatus } from '@prisma/client';

type SummaryInput = { range?: string };

const millisByRange: Record<string, number> = {
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(input: SummaryInput) {
    const now = new Date();
    const rangeParam = (input.range || '30d').toLowerCase();
    const windowMs = millisByRange[rangeParam] ?? millisByRange['30d'];
    const rangeStart = new Date(now.getTime() - windowMs);

    const [
      activeEnterpriseCount,
      customerCount,
      categoriesCount,
      pendingVouchersCount,
      revenueAgg,
      revenueOrders,
      ordersCount,
      pendingVouchersTop,
    ] = await Promise.all([
      this.prisma.enterprise.count({ where: { IsActive: true } }),
      this.prisma.customer.count(),
      this.prisma.foodCategory.count(),
      this.prisma.voucher.count({ where: { Status: VoucherStatus.Pending } }),
      this.prisma.order.aggregate({
        _sum: { TotalAmount: true },
        where: {
          OrderDate: { gte: rangeStart },
          Status: { in: [OrderStatus.Delivered, OrderStatus.Completed] },
        },
      }),
      this.prisma.order.findMany({
        where: {
          OrderDate: { gte: rangeStart },
          Status: { in: [OrderStatus.Delivered, OrderStatus.Completed] },
        },
        select: { OrderDate: true, TotalAmount: true },
        orderBy: { OrderDate: 'asc' },
      }),
      this.prisma.order.count({
        where: {
          OrderDate: { gte: rangeStart },
          Status: { in: [OrderStatus.Delivered, OrderStatus.Completed] },
        },
      }),
      this.prisma.voucher.findMany({
        where: { Status: VoucherStatus.Pending },
        orderBy: { CreatedAt: 'desc' },
        take: 3,
        select: {
          VoucherID: true,
          Code: true,
          DiscountPercent: true,
          DiscountAmount: true,
          Status: true,
          ExpiryDate: true,
          MaxUsage: true,
          UsedCount: true,
          CreatedAt: true,
          enterprise: { select: { EnterpriseName: true } },
        },
      }),
    ]);

    const revenueInRange = Number(revenueAgg._sum?.TotalAmount ?? 0);

    return {
      activeEnterpriseCount,
      customerCount,
      categoriesCount,
      pendingVouchersCount,
      revenueInRange,
      ordersCount,
      revenueOrders: revenueOrders.map((row) => ({
        orderDate: row.OrderDate.toISOString(),
        totalAmount: Number(row.TotalAmount),
      })),
      pendingVouchersTop: pendingVouchersTop.map((row) => ({
        id: row.VoucherID,
        code: row.Code,
        discountPercent:
          row.DiscountPercent == null ? null : Number(row.DiscountPercent),
        discountAmount:
          row.DiscountAmount == null ? null : Number(row.DiscountAmount),
        status: row.Status,
        expiryDate: row.ExpiryDate?.toISOString() ?? null,
        maxUsage: row.MaxUsage ?? null,
        usedCount: row.UsedCount ?? 0,
        createdAt: row.CreatedAt.toISOString(),
        enterpriseName: row.enterprise?.EnterpriseName ?? null,
      })),
    };
  }
}

