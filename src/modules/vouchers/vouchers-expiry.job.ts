import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@infra/prisma/prisma.service';
import { VouchersService } from '@modules/vouchers/vouchers.service';
import { VoucherStatus } from '@prisma/client';

@Injectable()
export class VouchersExpiryJob {
  private readonly logger = new Logger(VouchersExpiryJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vouchersService: VouchersService,
  ) {}

  /**
   * Mark expired vouchers as Expired so they won't be usable.
   *
   * NOTE: The checkout flow already filters by ExpiryDate, but this keeps the
   * dashboard/enterprise views consistent and prevents stale Approved statuses.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async markExpiredVouchers(): Promise<void> {
    const now = new Date();

    const res = await this.prisma.voucher.updateMany({
      where: {
        Status: { in: [VoucherStatus.Approved, VoucherStatus.Pending] },
        ExpiryDate: { lte: now },
      },
      data: { Status: VoucherStatus.Expired },
    });

    if (res.count > 0) {
      await this.vouchersService.invalidateApprovedListCache();
      this.logger.log(`Marked ${res.count} expired vouchers as Expired.`);
    }
  }
}

