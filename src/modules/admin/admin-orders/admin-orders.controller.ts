import { Controller, Get, Query, Param } from '@nestjs/common';
import { AdminOrdersService } from './admin-orders.service';
import { OrderStatus, PaymentMethod } from '@prisma/client';

@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly service: AdminOrdersService) {}

  // Danh sách orders (cursor pagination + filter)
  @Get()
  async list(
    @Query('orderId') orderId?: string,
    @Query('enterpriseId') enterpriseId?: string,
    @Query('buyerSearch') buyerSearch?: string,
    @Query('status') status?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listOrders({
      orderId,
      enterpriseId,
      buyerSearch,

      status: status as OrderStatus,

      paymentMethod: paymentMethod as PaymentMethod,

      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,

      take: limit ? parseInt(limit, 10) : 10,
      cursor,
    });
  }

  // Chi tiết order
  @Get(':orderId')
  async getDetail(@Param('orderId') orderId: string) {
    return this.service.getOrderById(orderId);
  }
}
