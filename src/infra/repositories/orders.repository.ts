import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import type { OrderCartItemDto } from '@modules/orders/orders.service';
import { ORDER_STATUS, PAYMENT_STATUS } from '@common/constants/order-payment-status.constants';
import { PAYMENT_METHOD } from '@common/constants/payment-method.constants';

export interface OrderListCriteria {
  customerId: string;
  status?: string;
  page?: number;
  limit?: number;
  startDate?: Date;
  endDate?: Date;
}

export const OrdersRepositoryLimits = {
  defaultPageSize: 10,
  minPageSize: 1,
  maxPageSize: 50,
} as const;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  normalizePagination(
    page?: number,
    limit?: number,
  ): { page: number; limit: number; skip: number } {
    const safeLimit = Math.min(
      Math.max(limit ?? OrdersRepositoryLimits.defaultPageSize, OrdersRepositoryLimits.minPageSize),
      OrdersRepositoryLimits.maxPageSize,
    );
    const safePage = Math.max(page ?? 1, 1);
    const skip = (safePage - 1) * safeLimit;
    return { page: safePage, limit: safeLimit, skip };
  }

  async findCustomerByAccountId(accountId: string) {
    return this.prisma.customer.findUnique({
      where: { AccountID: accountId },
      select: { CustomerID: true },
    });
  }

  async findManyForCustomer(criteria: OrderListCriteria) {
    const { page, limit, skip } = this.normalizePagination(
      criteria.page,
      criteria.limit,
    );

    const where: Prisma.OrderWhereInput = {
      CustomerID: criteria.customerId,
    };

    if (criteria.status) {
      where.Status = criteria.status.toUpperCase() as OrderStatus;
    }

    if (criteria.startDate || criteria.endDate) {
      where.OrderDate = {};
      if (criteria.startDate) {
        where.OrderDate.gte = criteria.startDate;
      }
      if (criteria.endDate) {
        where.OrderDate.lte = criteria.endDate;
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          orderDetails: {
            include: {
              food: {
                select: {
                  FoodID: true,
                  DishName: true,
                  Price: true,
                  ImageURL: true,
                  EnterpriseID: true,
                  enterprise: {
                    select: {
                      EnterpriseName: true,
                      account: { select: { Avatar: true } },
                    },
                  },
                },
              },
            },
          },
          customer: {
            select: {
              FullName: true,
            },
          },
        },
        orderBy: { OrderDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  async findById(orderId: string) {
    return this.prisma.order.findUnique({
      where: { OrderID: orderId },
      include: {
        orderDetails: {
          include: {
            food: {
              include: {
                enterprise: { select: { EnterpriseID: true, EnterpriseName: true, account: { select: { Avatar: true } } } },
              },
            },
          },
        },
        payments: { orderBy: { PaymentDate: 'desc' }, take: 1 },
      },
    });
  }

  async findForOwnershipCheck(orderId: string) {
    return this.prisma.order.findUnique({
      where: { OrderID: orderId },
      select: { CustomerID: true, Status: true },
    });
  }

  async deleteOrderCascade(orderId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.settlementItem.deleteMany({ where: { OrderID: orderId } });
      await tx.payment.deleteMany({ where: { OrderID: orderId } });
      await tx.orderDetail.deleteMany({ where: { OrderID: orderId } });
      await tx.order.delete({ where: { OrderID: orderId } });
    });
  }

  async validateFoodsAvailability(cartItems: OrderCartItemDto[]) {
    for (const item of cartItems) {
      const food = await this.prisma.food.findUnique({
        where: { FoodID: item.menuItem.id },
        select: { DishName: true, IsAvailable: true, Price: true },
      });
      if (!food) {
        throw new Error(`Food item not found: ${item.menuItem.id}`);
      }
      if (!food.IsAvailable) {
        throw new Error(`Item ${food.DishName} is currently unavailable`);
      }
    }
  }

  async findValidVoucherId(code: string): Promise<string | null> {
    const voucher = await this.prisma.voucher.findFirst({
      where: {
        Code: code,
        Status: 'Approved',
        ExpiryDate: { gt: new Date() },
      },
      select: { VoucherID: true },
    });
    return voucher?.VoucherID ?? null;
  }

  async createOrderWithDetailsAndPayment(params: {
    customerId: string;
    cartItems: OrderCartItemDto[];
    deliveryAddress: string;
    voucherId: string | null;
    totalAmount: number;
    paymentIntentId?: string;
  }) {
    const order = await this.prisma.order.create({
      data: {
        CustomerID: params.customerId,
        VoucherID: params.voucherId,
        TotalAmount: params.totalAmount,
        DeliveryAddress: params.deliveryAddress,
        DeliveryNote: '',
        Status: ORDER_STATUS.Pending,
      },
    });

    const orderDetails = await Promise.all(
      params.cartItems.map(async (item) => {
        const orderDetail = await this.prisma.orderDetail.create({
          data: {
            OrderID: order.OrderID,
            FoodID: item.menuItem.id,
            SubTotal: item.menuItem.price * item.quantity,
            Quantity: item.quantity,
          },
        });
        return orderDetail;
      }),
    );

    if (params.paymentIntentId) {
      await this.prisma.payment.create({
        data: {
          PaymentID: params.paymentIntentId,
          OrderID: order.OrderID,
          PaymentMethod: PAYMENT_METHOD.CreditCard,
          TransactionID: params.paymentIntentId,
          PaymentStatus: PAYMENT_STATUS.Completed,
          TransactionData: {
            payment_intent_id: params.paymentIntentId,
            status: 'succeeded',
            amount: Number(order.TotalAmount) * 100,
            currency: 'usd',
          },
        },
      });
    }

    return { order, orderDetails };
  }

  async createReorderFromExisting(order: {
    OrderID: string;
    CustomerID: string;
    VoucherID: string | null;
    TotalAmount: Prisma.Decimal | number;
    DeliveryAddress: string;
    DeliveryNote: string | null;
    orderDetails: Array<{
      OrderDetailID: string;
      OrderID: string;
      FoodID: string;
      SubTotal: Prisma.Decimal | number;
      Quantity: number;
    }>;
  }) {
    const newOrder = await this.prisma.order.create({
      data: {
        CustomerID: order.CustomerID,
        VoucherID: order.VoucherID,
        TotalAmount: order.TotalAmount,
        DeliveryAddress: order.DeliveryAddress,
        DeliveryNote: order.DeliveryNote,
        Status: ORDER_STATUS.Pending,
      },
    });

    await Promise.all(
      order.orderDetails.map((item) =>
        this.prisma.orderDetail.create({
          data: {
            OrderID: newOrder.OrderID,
            FoodID: item.FoodID,
            SubTotal: item.SubTotal,
            Quantity: item.Quantity,
          },
        }),
      ),
    );

    return newOrder;
  }
}

