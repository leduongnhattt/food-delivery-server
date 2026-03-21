import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';

@Module({
  imports: [PrismaModule],
  controllers: [VouchersController],
  providers: [VouchersService],
})
export class VouchersModule {}

