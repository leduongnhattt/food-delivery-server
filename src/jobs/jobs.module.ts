import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { OrderAutoCompleteJob } from '@src/jobs/orders/order-auto-complete.job';
import { EnterpriseInvitationCleanupJob } from '@src/jobs/enterprise/enterprise-invitation-cleanup.job';

@Module({
  imports: [PrismaModule],
  providers: [OrderAutoCompleteJob, EnterpriseInvitationCleanupJob],
})
export class JobsModule {}

