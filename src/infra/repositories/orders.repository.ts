import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import type { OrderCartItemDto } from '@modules/orders/orders.service';
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
} from '@common/constants/order-payment-status.constants';
import { PAYMENT_METHOD } from '@common/constants/payment-method.constants';

export type OrderForCustomerList = Prisma.OrderGetPayload<{
  include: {
    orderDetails: {
      include: {
        food: {
          select: {
            FoodID: true;
            DishName: true;
            Price: true;
            ImageURL: true;
            EnterpriseID: true;
            enterprise: {
              select: {
                EnterpriseName: true;
                account: { select: { Avatar: true } };
              };
            };
          };
        };
      };
    };
    customer: { select: { FullName: true } };
    payments: true;
    returnRequest: { select: { Status: true } };
  };
}>;

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
      Math.max(
        limit ?? OrdersRepositoryLimits.defaultPageSize,
        OrdersRepositoryLimits.minPageSize,
      ),
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

  async findManyForCustomer(criteria: OrderListCriteria): Promise<{
    rows: OrderForCustomerList[];
    total: number;
    page: number;
    limit: number;
  }> {
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
          payments: { orderBy: { PaymentDate: 'desc' }, take: 1 },
          returnRequest: { select: { Status: true } },
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
                enterprise: {
                  select: {
                    EnterpriseID: true,
                    EnterpriseName: true,
                    account: { select: { Avatar: true } },
                  },
                },
              },
            },
          },
        },
        payments: { orderBy: { PaymentDate: 'desc' }, take: 1 },
        returnRequest: { select: { Status: true } },
      },
    });
  }

  async findForOwnershipCheck(orderId: string) {
    return this.prisma.order.findUnique({
      where: { OrderID: orderId },
      select: { CustomerID: true, Status: true },
    });
  }

  async findCancelContextForCustomer(orderId: string) {
    return this.prisma.order.findUnique({
      where: { OrderID: orderId },
      select: {
        OrderID: true,
        CustomerID: true,
        Status: true,
        Metadata: true,
        OrderDate: true,
        payments: {
          orderBy: { PaymentDate: 'desc' },
          take: 1,
          select: { PaymentMethod: true, PaymentStatus: true },
        },
        orderDetails: {
          select: { food: { select: { EnterpriseID: true } } },
        },
      },
    });
  }

  async cancelPendingOrder(params: {
    orderId: string;
    cutoff?: Date;
    cancelReason: string;
    refundPending?: boolean;
  }): Promise<{ updated: boolean; enterpriseIds: string[] }> {
    const ctx = await this.findCancelContextForCustomer(params.orderId);
    if (!ctx) return { updated: false, enterpriseIds: [] };

    const enterpriseIds = Array.from(
      new Set(
        ctx.orderDetails
          .map((d) => d.food?.EnterpriseID)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    );

    const base =
      ctx.Metadata &&
      typeof ctx.Metadata === 'object' &&
      !Array.isArray(ctx.Metadata)
        ? (ctx.Metadata as Record<string, unknown>)
        : {};

    const nextMeta = {
      ...base,
      cancelReason: params.cancelReason,
      cancelledAt: new Date().toISOString(),
      ...(params.refundPending
        ? { refundPending: true, refundReason: params.cancelReason }
        : {}),
    };

    // Atomic soft-cancel: only cancel if still Pending (and optional cutoff condition holds).
    const res = await this.prisma.order.updateMany({
      where: {
        OrderID: params.orderId,
        Status: OrderStatus.Pending,
        ...(params.cutoff ? { OrderDate: { lte: params.cutoff } } : {}),
      },
      data: { Status: OrderStatus.Cancelled, Metadata: nextMeta },
    });

    // If we cancelled a COD order where payment is still Pending, mark that payment Failed.
    if (res.count > 0) {
      const latest = ctx.payments[0];
      if (latest?.PaymentMethod === PaymentMethod.Cash) {
        await this.prisma.payment.updateMany({
          where: {
            OrderID: params.orderId,
            PaymentStatus: PaymentStatus.Pending,
          },
          data: { PaymentStatus: PaymentStatus.Failed },
        });
      }
    }

    return { updated: res.count > 0, enterpriseIds };
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

  async findEnterpriseIdByFirstFoodId(foodId: string): Promise<string | null> {
    if (!foodId?.trim()) return null;
    const row = await this.prisma.food.findUnique({
      where: { FoodID: foodId },
      select: { EnterpriseID: true },
    });
    return row?.EnterpriseID ?? null;
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
    /** Saved on `Order.Metadata.checkout` for admin / payment breakdown */
    checkoutPricing?: {
      subtotal: number;
      deliveryFee: number;
      voucherDiscount: number;
    };
  }) {
    const order = await this.prisma.order.create({
      data: {
        CustomerID: params.customerId,
        VoucherID: params.voucherId,
        TotalAmount: params.totalAmount,
        DeliveryAddress: params.deliveryAddress,
        DeliveryNote: '',
        Status: ORDER_STATUS.Pending,
        ...(params.checkoutPricing
          ? {
              Metadata: {
                checkout: {
                  subtotal: params.checkoutPricing.subtotal,
                  deliveryFee: params.checkoutPricing.deliveryFee,
                  voucherDiscount: params.checkoutPricing.voucherDiscount,
                },
              },
            }
          : {}),
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
}
