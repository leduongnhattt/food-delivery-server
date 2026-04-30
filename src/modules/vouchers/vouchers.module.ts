import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';
import { VouchersExpiryJob } from './vouchers-expiry.job';

@Module({
  imports: [PrismaModule],
  controllers: [VouchersController],
  providers: [VouchersService, VouchersExpiryJob],
  exports: [VouchersService],
})
export class VouchersModule {}

