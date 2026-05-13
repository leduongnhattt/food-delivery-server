import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EnterpriseInvitationStatus } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

@Injectable()
export class EnterpriseInvitationExpiryJob {
  private readonly logger = new Logger(EnterpriseInvitationExpiryJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marks pending invitations as Expired once ExpiresAt has passed (DB truth for admin UI).
   * Runs every 10 minutes; activation already rejects expired rows via ExpiresAt + Pending.
   */
  @Cron('*/10 * * * *')
  async run(): Promise<void> {
    const now = new Date();
    const res = await this.prisma.enterpriseInvitation.updateMany({
      where: {
        Status: EnterpriseInvitationStatus.Pending,
        ExpiresAt: { lte: now },
      },
      data: { Status: EnterpriseInvitationStatus.Expired },
    });
    if (res.count > 0) {
      this.logger.log(`Marked ${res.count} enterprise invitation(s) as Expired`);
    }
  }
}
