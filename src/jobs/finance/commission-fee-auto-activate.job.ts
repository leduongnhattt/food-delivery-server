import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@infra/prisma/prisma.service';

function getActivateAfterHours(): number {
  const raw = process.env.FINANCE_RULE_AUTO_ACTIVATE_AFTER_HOURS;
  const n = raw ? Number(raw) : 24;
  if (!Number.isFinite(n) || n <= 0) return 24;
  return n;
}

@Injectable()
export class CommissionFeeAutoActivateJob {
  private readonly logger = new Logger(CommissionFeeAutoActivateJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Auto-activate pending commission rules after a cooldown window.
   *
   * - Global: activates the most recent eligible pending rule and ensures only one global is active.
   * - Category rules: activates eligible pending rules in bulk.
   *
   * Runs hourly; eligibility is based on `CreatedAt` and `EffectiveFrom`.
   */
  @Cron('0 */1 * * *')
  async runHourly(): Promise<void> {
    const hours = getActivateAfterHours();
    const now = new Date();
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [categoryRes, globalActivated] = await this.prisma.$transaction(async (tx) => {
      const categoryRes = await tx.categoryCommissionDefault.updateMany({
        where: {
          DeletedAt: null,
          IsActive: false,
          ActivatedAt: null,
          CreatedAt: { lte: cutoff },
          EffectiveFrom: { lte: now },
        },
        data: { IsActive: true, ActivatedAt: now },
      });

      const eligibleGlobal = await tx.platformCommissionGlobalRule.findFirst({
        where: {
          DeletedAt: null,
          IsActive: false,
          ActivatedAt: null,
          CreatedAt: { lte: cutoff },
          EffectiveFrom: { lte: now },
        },
        orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
        select: { RuleID: true },
      });

      if (!eligibleGlobal) {
        return [categoryRes, false] as const;
      }

      await tx.platformCommissionGlobalRule.updateMany({
        where: { DeletedAt: null, IsActive: true },
        data: { IsActive: false },
      });
      await tx.platformCommissionGlobalRule.update({
        where: { RuleID: eligibleGlobal.RuleID },
        data: { IsActive: true, ActivatedAt: now },
      });

      return [categoryRes, true] as const;
    });

    if (categoryRes.count > 0 || globalActivated) {
      this.logger.log(
        `Auto-activated commission rules (category=${categoryRes.count}, global=${globalActivated ? 1 : 0}, cutoff=${cutoff.toISOString()}, hours=${hours})`,
      );
    }
  }
}

