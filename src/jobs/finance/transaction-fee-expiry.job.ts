import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@infra/prisma/prisma.service';

@Injectable()
export class TransactionFeeExpiryJob {
  private readonly logger = new Logger(TransactionFeeExpiryJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marks transaction fee rules as Expired when `EffectiveTo < now`.
   *
   * Applies to ALL states (Pending/Active/Inactive). Once expired:
   * - `ExpiredAt` is set (one-way)
   * - `IsActive` is forced to false
   */
  @Cron('*/10 * * * *')
  async runEveryTenMinutes(): Promise<void> {
    const now = new Date();

    const [channelRes, globalRes] = await this.prisma.$transaction([
      this.prisma.transactionFeeRule.updateMany({
        where: {
          DeletedAt: null,
          ExpiredAt: null,
          EffectiveTo: { not: null, lt: now },
        },
        data: { ExpiredAt: now, IsActive: false },
      }),
      this.prisma.transactionFeeGlobalRule.updateMany({
        where: {
          DeletedAt: null,
          ExpiredAt: null,
          EffectiveTo: { not: null, lt: now },
        },
        data: { ExpiredAt: now, IsActive: false },
      }),
    ]);

    const changed = (channelRes.count ?? 0) + (globalRes.count ?? 0);
    if (changed > 0) {
      this.logger.log(
        `Expired transaction fee rules (channel=${channelRes.count}, global=${globalRes.count}, now=${now.toISOString()})`,
      );
    }
  }
}

