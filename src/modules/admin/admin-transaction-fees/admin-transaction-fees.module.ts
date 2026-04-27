import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AdminTransactionFeesController } from './admin-transaction-fees.controller';
import { AdminTransactionFeesService } from './admin-transaction-fees.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminTransactionFeesController],
  providers: [AdminTransactionFeesService],
})
export class AdminTransactionFeesModule {}
