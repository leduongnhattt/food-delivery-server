import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminOrdersController],
  providers: [AdminOrdersService],
})
export class AdminOrdersModule {}
