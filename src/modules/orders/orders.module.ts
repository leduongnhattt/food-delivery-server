import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { OrdersController } from '@modules/orders/orders.controller';
import { OrdersService } from '@modules/orders/orders.service';
import { OrdersRepository } from '@infra/repositories/orders.repository';
import { CustomersModule } from '@modules/customers/customers.module';
import { AuthModule } from '@modules/auth/auth.module';
import { ShippingModule } from '@modules/shipping/shipping.module';
import { ReturnsService } from '@modules/orders/returns/returns.service';
import { CommissionSettlementModule } from '@modules/payments/commission-settlement/commission-settlement.module';

@Module({
  imports: [
    PrismaModule,
    CustomersModule,
    AuthModule,
    ShippingModule,
    CommissionSettlementModule,
  ],
  providers: [OrdersService, OrdersRepository, ReturnsService],
  controllers: [OrdersController],
})
export class OrdersModule {}

