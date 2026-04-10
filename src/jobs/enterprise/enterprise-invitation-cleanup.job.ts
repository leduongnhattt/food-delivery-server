import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@infra/prisma/prisma.service';
import { AccountStatus } from '@prisma/client';

@Injectable()
export class EnterpriseInvitationCleanupJob {
  private readonly logger = new Logger(EnterpriseInvitationCleanupJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deletes expired enterprise invitations and their pending accounts.
   *
   * Runs daily. Only deletes accounts that are still `Inactive` and have no linked Enterprise.
   */
  @Cron('0 2 * * *') // 02:00 daily
  async runDaily(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.enterpriseInvitation.findMany({
      where: {
        Status: 'Pending',
        ExpiresAt: { lte: now },
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
      } catch (e) {
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

