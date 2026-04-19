import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { OrdersController } from '@modules/orders/orders.controller';
import { OrdersService } from '@modules/orders/orders.service';
import { OrdersRepository } from '@infra/repositories/orders.repository';
import { CustomersModule } from '@modules/customers/customers.module';
import { AuthModule } from '@modules/auth/auth.module';
import { ShippingModule } from '@modules/shipping/shipping.module';
import { ReturnsService } from '@modules/orders/returns/returns.service';

@Module({
  imports: [PrismaModule, CustomersModule, AuthModule, ShippingModule],
  providers: [OrdersService, OrdersRepository, ReturnsService],
  controllers: [OrdersController],
})
export class OrdersModule {}

