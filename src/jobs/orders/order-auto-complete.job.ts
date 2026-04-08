import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@infra/prisma/prisma.service';
import { OrderStatus } from '@prisma/client';

function getAutoCompleteAfterHours(): number {
  const raw = process.env.ORDER_AUTO_COMPLETE_AFTER_HOURS;
  const n = raw ? Number(raw) : 48;
  if (!Number.isFinite(n) || n <= 0) return 48;
  return n;
}

@Injectable()
export class OrderAutoCompleteJob {
  private readonly logger = new Logger(OrderAutoCompleteJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Auto-complete delivered orders after a cooldown window.
   *
   * Runs hourly to move `Delivered -> Completed` when `DeliveredAt` is older than
   * `ORDER_AUTO_COMPLETE_AFTER_HOURS` (default 48).
   */
  @Cron('0 */1 * * *')
  async runHourly(): Promise<void> {
    const hours = getAutoCompleteAfterHours();
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const res = await this.prisma.order.updateMany({
      where: {
        Status: OrderStatus.Delivered,
        DeliveredAt: { not: null, lte: cutoff },
      },
      data: {
        Status: OrderStatus.Completed,
      },
    });

    if (res.count > 0) {
      this.logger.log(
        `Auto-completed ${res.count} order(s) (cutoff=${cutoff.toISOString()}, hours=${hours})`,
      );
    }
  }
}

