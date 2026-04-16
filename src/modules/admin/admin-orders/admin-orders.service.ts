import { Injectable } from "@nestjs/common";
import { OrderStatus, PaymentMethod } from "@prisma/client";
import { PrismaService } from "@src/infra/prisma/prisma.service";

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(params: {
    orderId?: string;
    enterpriseId?: string;
    buyerSearch?: string;
    status?: OrderStatus;
    paymentMethod?: string;
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

        params.buyerSearch
          ? {
              customer: {
                account: {
                  OR: [
                    { Email: { contains: params.buyerSearch } },
                    { Username: { contains: params.buyerSearch } },
                  ],
                },
              },
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

  // Danh sách đơn hàng với phân trang cursor-based, search theo mã đơn hàng, from to date, sắp xếp theo ngày mới nhất
  async listOrders(params: {
    orderId?: string;
    enterpriseId?: string;
    buyerSearch?: string;
    status?: OrderStatus;
    paymentMethod?: string;
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
      },
    });

    let nextCursor: string | null = null;

    if (rows.length > params.take) {
      const next = rows.pop();
      nextCursor = next?.OrderID ?? null;
    }

    return {
      items: rows,
      nextCursor,
    };
  }

  // Lấy chi tiết đơn hàng cho modal ở FE
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
}