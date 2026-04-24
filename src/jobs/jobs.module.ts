import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { CommissionFeeAutoActivateJob } from '@src/jobs/finance/commission-fee-auto-activate.job';
import { TransactionFeeAutoActivateJob } from '@src/jobs/finance/transaction-fee-auto-activate.job';
import { OrderAutoCompleteJob } from '@src/jobs/orders/order-auto-complete.job';
import { OrderAcceptanceTimeoutJob } from '@src/jobs/orders/order-acceptance-timeout.job';
import { EnterpriseInvitationCleanupJob } from '@src/jobs/enterprise/enterprise-invitation-cleanup.job';
import { EnterprisePayoutRequestExpiryJob } from '@src/jobs/enterprise/enterprise-payout-request-expiry.job';

@Module({
  imports: [PrismaModule],
  providers: [
    // orders
    OrderAutoCompleteJob,
    OrderAcceptanceTimeoutJob,

    // enterprise
    EnterpriseInvitationCleanupJob,
    EnterprisePayoutRequestExpiryJob,

    // finance
    CommissionFeeAutoActivateJob,
    TransactionFeeAutoActivateJob,
  ],
})
export class JobsModule {}
