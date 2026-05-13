import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { CommissionFeeAutoActivateJob } from '@src/jobs/finance/commission-fee-auto-activate.job';
import { TransactionFeeAutoActivateJob } from '@src/jobs/finance/transaction-fee-auto-activate.job';
import { CommissionFeeExpiryJob } from '@src/jobs/finance/commission-fee-expiry.job';
import { TransactionFeeExpiryJob } from '@src/jobs/finance/transaction-fee-expiry.job';
import { OrderAutoCompleteJob } from '@src/jobs/orders/order-auto-complete.job';
import { OrderAcceptanceTimeoutJob } from '@src/jobs/orders/order-acceptance-timeout.job';
import { EnterpriseInvitationCleanupJob } from '@src/jobs/enterprise/enterprise-invitation-cleanup.job';
import { EnterpriseInvitationExpiryJob } from '@src/jobs/enterprise/enterprise-invitation-expiry.job';
import { EnterprisePayoutRequestExpiryJob } from '@src/jobs/enterprise/enterprise-payout-request-expiry.job';

@Module({
  imports: [PrismaModule],
  providers: [
    // orders
    OrderAutoCompleteJob,
    OrderAcceptanceTimeoutJob,

    // enterprise
    EnterpriseInvitationExpiryJob,
    EnterpriseInvitationCleanupJob,
    EnterprisePayoutRequestExpiryJob,

    // finance
    CommissionFeeAutoActivateJob,
    TransactionFeeAutoActivateJob,
    CommissionFeeExpiryJob,
    TransactionFeeExpiryJob,
  ],
})
export class JobsModule { }
