import { Controller, Get, Query, Param, Delete } from '@nestjs/common';
import { AdminOrdersService } from './admin-orders.service';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly service: AdminOrdersService) { }

  @Get()
  async list(
    @Query('orderId') orderId?: string,
    @Query('enterpriseId') enterpriseId?: string,
    @Query('buyerSearch') buyerSearch?: string,
    @Query('status') status?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('paymentStatus') paymentStatus?: string,
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
      paymentStatus: paymentStatus as PaymentStatus,

      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,

      take: limit ? parseInt(limit, 10) : 10,
      cursor,
    });
  }

  @Get(':orderId')
  async getDetail(@Param('orderId') orderId: string) {
    return this.service.getOrderById(orderId);
  }

  @Delete(':orderId')
  async deleteOrder(@Param('orderId') orderId: string) {
    return this.service.deleteOrder(orderId);
  }
}
