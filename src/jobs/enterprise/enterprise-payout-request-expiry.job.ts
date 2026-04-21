import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@infra/prisma/prisma.service';
import {
  EnterpriseLedgerEntryStatus,
  EnterprisePayoutRequestStatus,
} from '@prisma/client';

@Injectable()
export class EnterprisePayoutRequestExpiryJob {
  private readonly logger = new Logger(EnterprisePayoutRequestExpiryJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marks pending payout requests as Expired once ExpiresAt is passed.
   * Runs every 10 minutes to keep UX consistent with the 2-day SLA.
   */
  @Cron('*/10 * * * *')
  async run(): Promise<void> {
    const now = new Date();

    const candidates = await this.prisma.enterprisePayoutRequest.findMany({
      where: {
        Status: EnterprisePayoutRequestStatus.Pending,
        ExpiresAt: { lte: now },
      },
      select: { PayoutRequestID: true },
      take: 200,
    });
    if (candidates.length === 0) return;

    let updated = 0;
    for (const c of candidates) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const row = await tx.enterprisePayoutRequest.findUnique({
            where: { PayoutRequestID: c.PayoutRequestID },
            select: { PayoutRequestID: true, Status: true },
          });
          if (!row) return;
          if (row.Status !== EnterprisePayoutRequestStatus.Pending) return;

          await tx.enterprisePayoutRequest.update({
            where: { PayoutRequestID: row.PayoutRequestID },
            data: { Status: EnterprisePayoutRequestStatus.Expired },
          });

          await tx.enterpriseLedgerEntry.updateMany({
            where: { PayoutRequestID: row.PayoutRequestID },
            data: { Status: EnterpriseLedgerEntryStatus.Expired },
          });
        });
        updated++;
      } catch {
        this.logger.warn(
          `Failed to expire payout request ${c.PayoutRequestID}`,
        );
      }
    }

    if (updated > 0) {
      this.logger.log(`Expired ${updated} payout request(s)`);
    }
  }
}

