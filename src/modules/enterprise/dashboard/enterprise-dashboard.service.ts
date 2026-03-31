import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { getKeyJson, setKeyJson } from '@infra/redis/redis.service';

const STATS_KEY = (enterpriseId: string) => `enterprise:${enterpriseId}:dashboard:stats`;
const REVENUE_KEY = (enterpriseId: string) =>
  `enterprise:${enterpriseId}:dashboard:revenue`;

const TTL = {
  STATS: 5 * 60,
  REVENUE: 10 * 60,
} as const;

export interface DashboardStatsData {
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  totalProducts: number;
  pendingOrders: number;
  completedOrders: number;
  averageRating: number;
  revenueGrowth: number;
  orderGrowth: number;
  lastUpdated: string;
}

export interface DashboardRevenueData {
  data: Array<{ date: string; revenue: number }>;
  lastUpdated: string;
}

@Injectable()
export class EnterpriseDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async getEnterpriseIdByAccountId(accountId: string): Promise<string> {
    const enterprise = await this.prisma.enterprise.findUnique({
      where: { AccountID: accountId },
      select: { EnterpriseID: true },
    });
    if (!enterprise) throw new BadRequestException('Enterprise not found');
    return enterprise.EnterpriseID;
  }

  async getStats(accountId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const cached = await getKeyJson<DashboardStatsData>(STATS_KEY(enterpriseId));
    if (cached) {
      return { success: true, ...cached, fromCache: true };
    }

    const [
      totalOrders,
      totalRevenue,
      totalCustomers,
      totalProducts,
      pendingOrders,
      completedOrders,
      averageRating,
      lastMonthStats,
    ] = await Promise.all([
      this.prisma.order.count({
        where: {
          orderDetails: {
            some: { food: { EnterpriseID: enterpriseId } },
          },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          Status: 'Completed',
          orderDetails: {
            some: { food: { EnterpriseID: enterpriseId } },
          },
        },
        _sum: { TotalAmount: true },
      }),
      this.prisma.order
        .groupBy({
          by: ['CustomerID'],
          where: {
            orderDetails: {
              some: { food: { EnterpriseID: enterpriseId } },
            },
          },
        })
        .then((result) => result.length),
      this.prisma.food.count({ where: { EnterpriseID: enterpriseId } }),
      this.prisma.order.count({
        where: {
          Status: 'Pending',
          orderDetails: {
            some: { food: { EnterpriseID: enterpriseId } },
          },
        },
      }),
      this.prisma.order.count({
        where: {
          Status: 'Completed',
          orderDetails: {
            some: { food: { EnterpriseID: enterpriseId } },
          },
        },
      }),
      this.prisma.review.aggregate({
        where: { EnterpriseID: enterpriseId },
        _avg: { Rating: true },
      }),
      this.prisma.order.aggregate({
        where: {
          orderDetails: {
            some: { food: { EnterpriseID: enterpriseId } },
          },
          OrderDate: {
            gte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
          },
        },
        _count: { OrderID: true },
        _sum: { TotalAmount: true },
      }),
    ]);

    const currentMonth = new Date();
    const lastMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    const currentMonthStats = await this.prisma.order.aggregate({
      where: {
        orderDetails: {
          some: { food: { EnterpriseID: enterpriseId } },
        },
        OrderDate: { gte: lastMonth },
      },
      _count: { OrderID: true },
      _sum: { TotalAmount: true },
    });

    const lastMonthRevenue = Number(lastMonthStats._sum?.TotalAmount || 0);
    const currentMonthRevenue = Number(currentMonthStats._sum?.TotalAmount || 0);
    const lastMonthOrders = lastMonthStats._count?.OrderID || 0;
    const currentMonthOrders = currentMonthStats._count?.OrderID || 0;

    const revenueGrowth =
      lastMonthRevenue > 0
        ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
        : 0;
    const orderGrowth =
      lastMonthOrders > 0
        ? ((currentMonthOrders - lastMonthOrders) / lastMonthOrders) * 100
        : 0;

    const stats: DashboardStatsData = {
      totalOrders: totalOrders || 0,
      totalRevenue: Number(totalRevenue._sum?.TotalAmount || 0),
      totalCustomers: totalCustomers || 0,
      totalProducts: totalProducts || 0,
      pendingOrders: pendingOrders || 0,
      completedOrders: completedOrders || 0,
      averageRating: Number(averageRating._avg?.Rating || 0),
      revenueGrowth: Math.round(revenueGrowth * 100) / 100,
      orderGrowth: Math.round(orderGrowth * 100) / 100,
      lastUpdated: new Date().toISOString(),
    };

    await setKeyJson(STATS_KEY(enterpriseId), stats, TTL.STATS);

    return { success: true, ...stats, fromCache: false };
  }

  async getRevenue(accountId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const cached = await getKeyJson<DashboardRevenueData>(REVENUE_KEY(enterpriseId));
    if (cached) {
      return {
        success: true,
        data: cached.data,
        lastUpdated: cached.lastUpdated,
        fromCache: true,
      };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const revenueDataFromDB = await this.prisma.order.groupBy({
      by: ['OrderDate'],
      where: {
        Status: 'Completed',
        orderDetails: {
          some: { food: { EnterpriseID: enterpriseId } },
        },
        OrderDate: { gte: thirtyDaysAgo },
      },
      _sum: { TotalAmount: true },
      orderBy: { OrderDate: 'asc' },
    });

    const formatted = revenueDataFromDB.map((item) => ({
      date: item.OrderDate.toISOString().split('T')[0],
      revenue: Number(item._sum?.TotalAmount || 0),
    }));

    const revenue: DashboardRevenueData = {
      data: formatted,
      lastUpdated: new Date().toISOString(),
    };

    await setKeyJson(REVENUE_KEY(enterpriseId), revenue, TTL.REVENUE);

    return {
      success: true,
      data: formatted,
      lastUpdated: revenue.lastUpdated,
      fromCache: false,
    };
  }
}

