import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@infra/prisma/prisma.service';
import { AccountStatus, EnterpriseInvitationStatus } from '@prisma/client';

/** After this many days past `ExpiresAt`, `Expired` rows may be purged with orphan inactive accounts. */
const EXPIRED_INVITATION_RETENTION_DAYS = 30;

@Injectable()
export class EnterpriseInvitationCleanupJob {
  private readonly logger = new Logger(EnterpriseInvitationCleanupJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deletes old `Expired` invitations and their unused inactive accounts (no Enterprise).
   * Pending rows past expiry are marked `Expired` by {@link EnterpriseInvitationExpiryJob} first.
   *
   * Runs daily. Only deletes accounts that are still `Inactive` and have no linked Enterprise.
   */
  @Cron('0 2 * * *') // 02:00 daily
  async runDaily(): Promise<void> {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - EXPIRED_INVITATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const expired = await this.prisma.enterpriseInvitation.findMany({
      where: {
        Status: EnterpriseInvitationStatus.Expired,
        ExpiresAt: { lte: cutoff },
      },
      select: { InvitationID: true, AccountID: true, Email: true },
      take: 200,
    });

    if (expired.length === 0) return;

    let deleted = 0;
    for (const inv of expired) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.enterpriseInvitation.delete({
            where: { InvitationID: inv.InvitationID },
          });

          const acc = await tx.account.findUnique({
            where: { AccountID: inv.AccountID },
            select: { AccountID: true, Status: true, enterprise: { select: { EnterpriseID: true } } },
          });
          if (!acc) return;
          if (acc.enterprise) return;
          if (acc.Status !== AccountStatus.Inactive) return;

          await tx.account.delete({ where: { AccountID: inv.AccountID } });
        });
        deleted++;
      } catch {
        this.logger.warn(
          `Failed to cleanup invitation ${inv.InvitationID} (${inv.Email})`,
        );
      }
    }

    if (deleted > 0) {
      this.logger.log(`Cleaned up ${deleted} expired enterprise invitation(s)`);
    }
  }
}

