import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

@Injectable()
export class EnterpriseCheckDataService {
  constructor(private readonly prisma: PrismaService) {}

  async run(accountId: string) {
    const enterprise = await this.prisma.enterprise.findUnique({
      where: { AccountID: accountId },
      select: { EnterpriseID: true },
    });
    if (!enterprise) throw new BadRequestException('Enterprise not found');

    const enterpriseId = enterprise.EnterpriseID;

    const checks = {
      enterpriseId,
      totalEnterprises: await this.prisma.enterprise.count(),
      totalOrders: await this.prisma.order.count(),
      totalFoods: await this.prisma.food.count(),
      totalCustomers: await this.prisma.customer.count(),
      totalOrderDetails: await this.prisma.orderDetail.count(),
    };

    const enterpriseFoods = await this.prisma.food.findMany({
      where: { EnterpriseID: enterpriseId },
      select: { FoodID: true, DishName: true },
    });

    const ordersWithThisEnterprise = await this.prisma.order.findMany({
      where: {
        orderDetails: {
          some: {
            food: { EnterpriseID: enterpriseId },
          },
        },
      },
      select: { OrderID: true, TotalAmount: true, Status: true },
    });

    return {
      checks,
      enterpriseFoods: enterpriseFoods.length,
      foods: enterpriseFoods,
      ordersWithThisEnterprise: ordersWithThisEnterprise.length,
      orders: ordersWithThisEnterprise,
    };
  }
}

