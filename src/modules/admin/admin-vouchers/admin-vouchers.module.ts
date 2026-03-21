import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { VouchersModule } from '@modules/vouchers/vouchers.module';
import { AdminVouchersController } from './admin-vouchers.controller';
import { AdminVouchersService } from './admin-vouchers.service';

@Module({
  imports: [PrismaModule, AuthModule, VouchersModule],
  controllers: [AdminVouchersController],
  providers: [AdminVouchersService],
})
export class AdminVouchersModule {}
