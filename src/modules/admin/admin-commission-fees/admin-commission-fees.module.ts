import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AdminCommissionFeesController } from './admin-commission-fees.controller';
import { AdminCommissionFeesService } from './admin-commission-fees.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminCommissionFeesController],
  providers: [AdminCommissionFeesService],
})
export class AdminCommissionFeesModule {}
