import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AdminPayoutRequestsController } from '@modules/admin/admin-payout-requests/admin-payout-requests.controller';
import { AdminPayoutRequestsService } from '@modules/admin/admin-payout-requests/admin-payout-requests.service';
import { AuthModule } from '@modules/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminPayoutRequestsController],
  providers: [AdminPayoutRequestsService],
  exports: [AdminPayoutRequestsService],
})
export class AdminPayoutRequestsModule {}

