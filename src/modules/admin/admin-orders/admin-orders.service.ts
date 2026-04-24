import { Injectable, BadRequestException } from "@nestjs/common";
import { OrderStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { PrismaService } from "@src/infra/prisma/prisma.service";

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) { }

  private buildWhere(params: {
    orderId?: string;
    enterpriseId?: string;
    buyerSearch?: string;
    status?: OrderStatus;
    paymentMethod?: string;
    paymentStatus?: PaymentStatus;
    fromDate?: Date;
    toDate?: Date;
  }) {
    return {
      AND: [
        params.orderId ? { OrderID: params.orderId } : {},

        params.enterpriseId
          ? {
            orderDetails: {
              some: {
                food: {
                  EnterpriseID: params.enterpriseId,
                },
              },
            },
          }
          : {},

        params.status ? { Status: params.status } : {},

        params.paymentMethod
          ? {
            payments: {
              some: {
                PaymentMethod: params.paymentMethod as PaymentMethod,
              },
            },
          }
          : {},

        params.paymentStatus
          ? {
            payments: {
              some: {
                PaymentStatus: params.paymentStatus,
              },
            },
          }
          : {},

        params.buyerSearch
          ? {
            OR: [
              {
                customer: {
                  FullName: { contains: params.buyerSearch },
                },
              },
              {
                customer: {
                  account: {
                    OR: [
                      { Email: { contains: params.buyerSearch } },
                      { Username: { contains: params.buyerSearch } },
                    ],
                  },
                },
              },
              {
                orderDetails: {
                  some: {
                    food: {
                      enterprise: {
                        EnterpriseName: { contains: params.buyerSearch },
                      },
                    },
                  },
                },
              },
            ],
          }
          : {},

        params.fromDate || params.toDate
          ? {
            OrderDate: {
              ...(params.fromDate && { gte: params.fromDate }),
              ...(params.toDate && { lte: params.toDate }),
            },
          }
          : {},
      ],
    };
  }

  async listOrders(params: {
    orderId?: string;
    enterpriseId?: string;
    buyerSearch?: string;
    status?: OrderStatus;
    paymentMethod?: string;
    paymentStatus?: PaymentStatus;
    fromDate?: Date;
    toDate?: Date;
    take: number;
    cursor?: string;
  }) {
    const where = this.buildWhere(params);

    const rows = await this.prisma.order.findMany({
      where,

      take: params.take + 1,

      ...(params.cursor
        ? {
          cursor: { OrderID: params.cursor },
          skip: 1,
        }
        : {}),

      orderBy: [{ OrderDate: 'desc' }, { OrderID: 'desc' }],

      select: {
        OrderID: true,
        TotalAmount: true,
        Status: true,
        OrderDate: true,

        payments: {
          orderBy: { PaymentDate: "desc" },
          take: 1,
          select: {
            PaymentMethod: true,
            PaymentDate: true,
            PaymentStatus: true,
          },
        },

        customer: {
          select: {
            FullName: true,
            PhoneNumber: true,
            account: {
              select: {
                Email: true,
                Username: true,
              },
            },
          },
        },

        orderDetails: {
          select: {
            food: {
              select: {
                enterprise: {
                  select: {
                    EnterpriseName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    let nextCursor: string | null = null;

    if (rows.length > params.take) {
      const next = rows.pop();
      nextCursor = next?.OrderID ?? null;
    }

    const items = rows.map((r) => {
      const sellers = Array.from(
        new Set(
          (r.orderDetails ?? [])
            .map((d) => d.food?.enterprise?.EnterpriseName)
            .filter((x): x is string => typeof x === "string" && !!x.trim())
            .map((x) => x.trim()),
        ),
      );

      // Keep list payload compact: expose computed sellers instead of full orderDetails.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { orderDetails, ...rest } = r;
      return { ...rest, sellers };
    });

    return { items, nextCursor };
  }

  async getOrderById(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { OrderID: orderId },
      select: {
        OrderID: true,
        TotalAmount: true,
        Status: true,
        OrderDate: true,
        CustomerID: true,
        customer: {
          select: {
            FullName: true,
            PhoneNumber: true,
          },
        },
        orderDetails: {
          select: {
            FoodID: true,
            Quantity: true,
            SubTotal: true,
            food: {
              select: {
                DishName: true,
                Price: true,
                enterprise: {
                  select: {
                    EnterpriseID: true,
                    EnterpriseName: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new Error('Order not found');
    }
    return order;
  }

  async deleteOrder(orderId: string): Promise<{ success: true }> {
    if (!orderId?.trim()) {
      throw new BadRequestException("Order id is required");
    }

    // Mirror safe cascade used by OrdersRepository.deleteOrderCascade
    await this.prisma.$transaction(async (tx) => {
      await tx.settlementItem.deleteMany({ where: { OrderID: orderId } });
      await tx.payment.deleteMany({ where: { OrderID: orderId } });
      await tx.orderDetail.deleteMany({ where: { OrderID: orderId } });
      await tx.order.delete({ where: { OrderID: orderId } });
    });

    return { success: true };
  }
}