import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { OrdersController } from '@modules/orders/orders.controller';
import { OrdersService } from '@modules/orders/orders.service';
import { OrdersRepository } from '@infra/repositories/orders.repository';
import { CustomersModule } from '@modules/customers/customers.module';
import { AuthModule } from '@modules/auth/auth.module';

@Module({
  imports: [PrismaModule, CustomersModule, AuthModule],
  providers: [OrdersService, OrdersRepository],
  controllers: [OrdersController],
})
export class OrdersModule {}

