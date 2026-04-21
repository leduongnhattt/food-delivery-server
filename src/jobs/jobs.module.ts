import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { OrderAutoCompleteJob } from '@src/jobs/orders/order-auto-complete.job';
import { OrderAcceptanceTimeoutJob } from '@src/jobs/orders/order-acceptance-timeout.job';
import { EnterpriseInvitationCleanupJob } from '@src/jobs/enterprise/enterprise-invitation-cleanup.job';
import { EnterprisePayoutRequestExpiryJob } from '@src/jobs/enterprise/enterprise-payout-request-expiry.job';

@Module({
  imports: [PrismaModule],
  providers: [
    OrderAutoCompleteJob,
    OrderAcceptanceTimeoutJob,
    EnterpriseInvitationCleanupJob,
    EnterprisePayoutRequestExpiryJob,
  ],
})
export class JobsModule {}

