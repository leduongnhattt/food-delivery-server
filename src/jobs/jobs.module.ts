import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { OrderAutoCompleteJob } from '@src/jobs/orders/order-auto-complete.job';

@Module({
  imports: [PrismaModule],
  providers: [OrderAutoCompleteJob],
})
export class JobsModule {}

