import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@infra/prisma/prisma.service';

function getActivateAfterMinutes(): number {
  const raw = process.env.FINANCE_RULE_AUTO_ACTIVATE_AFTER_MINUTES;
  const n = raw ? Number(raw) : 10;
  if (!Number.isFinite(n) || n <= 0) return 10;
  return n;
}

@Injectable()
export class CommissionFeeAutoActivateJob {
  private readonly logger = new Logger(CommissionFeeAutoActivateJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Auto-activate pending commission rules after a short review window.
   *
   * - Global: activates the most recent eligible pending rule and ensures only one global is active.
   * - Category rules: at most one active rule per `FoodCategoryID` (same semantics as admin PATCH).
   *
   * Also reconciles duplicate Active rows per category (e.g. legacy bulk-activate), keeping the
   * rule with latest `EffectiveFrom` then `CreatedAt`.
   *
   * Runs every 10 minutes; eligibility is based on `EffectiveFrom` (start reached) and a short
   * "cooldown" based on `CreatedAt` (defaults to 10 minutes).
   */
  @Cron('*/10 * * * *')
  async runEveryTenMinutes(): Promise<void> {
    const minutes = getActivateAfterMinutes();
    const now = new Date();
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    const [categoryActivated, categoryHealed, globalActivated] = await this.prisma.$transaction(
      async (tx) => {
        const eligibleCategory = await tx.categoryCommissionDefault.findMany({
          where: {
            DeletedAt: null,
            IsActive: false,
            ActivatedAt: null,
            ExpiredAt: null,
            EffectiveFrom: { lte: now },
            OR: [{ EffectiveTo: null }, { EffectiveTo: { gte: now } }],
            CreatedAt: { lte: cutoff },
          },
          orderBy: [
            { FoodCategoryID: 'asc' },
            { EffectiveFrom: 'desc' },
            { CreatedAt: 'desc' },
          ],
          select: { CommissionDefaultID: true, FoodCategoryID: true },
        });

        let activated = 0;
        let lastFoodCategoryId: string | null = null;
        for (const r of eligibleCategory) {
          if (r.FoodCategoryID === lastFoodCategoryId) continue;
          lastFoodCategoryId = r.FoodCategoryID;

          await tx.categoryCommissionDefault.updateMany({
            where: {
              FoodCategoryID: r.FoodCategoryID,
              DeletedAt: null,
              ExpiredAt: null,
              IsActive: true,
              NOT: { CommissionDefaultID: r.CommissionDefaultID },
            },
            data: { IsActive: false },
          });
          await tx.categoryCommissionDefault.update({
            where: { CommissionDefaultID: r.CommissionDefaultID },
            data: { IsActive: true, ActivatedAt: now },
          });
          activated += 1;
        }

        const activeSameWindow = await tx.categoryCommissionDefault.findMany({
          where: {
            DeletedAt: null,
            ExpiredAt: null,
            IsActive: true,
            OR: [{ EffectiveTo: null }, { EffectiveTo: { gte: now } }],
          },
          orderBy: [
            { FoodCategoryID: 'asc' },
            { EffectiveFrom: 'desc' },
            { CreatedAt: 'desc' },
          ],
          select: { CommissionDefaultID: true, FoodCategoryID: true },
        });

        let healed = 0;
        let lastCatForHeal: string | null = null;
        for (const r of activeSameWindow) {
          if (r.FoodCategoryID !== lastCatForHeal) {
            lastCatForHeal = r.FoodCategoryID;
            continue;
          }
          await tx.categoryCommissionDefault.update({
            where: { CommissionDefaultID: r.CommissionDefaultID },
            data: { IsActive: false },
          });
          healed += 1;
        }

        const eligibleGlobal = await tx.platformCommissionGlobalRule.findFirst({
          where: {
            DeletedAt: null,
            IsActive: false,
            ActivatedAt: null,
            ExpiredAt: null,
            EffectiveFrom: { lte: now },
            OR: [{ EffectiveTo: null }, { EffectiveTo: { gte: now } }],
            CreatedAt: { lte: cutoff },
          },
          orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
          select: { RuleID: true },
        });

        if (!eligibleGlobal) {
          return [activated, healed, false] as const;
        }

        await tx.platformCommissionGlobalRule.updateMany({
          where: { DeletedAt: null, IsActive: true },
          data: { IsActive: false },
        });
        await tx.platformCommissionGlobalRule.update({
          where: { RuleID: eligibleGlobal.RuleID },
          data: { IsActive: true, ActivatedAt: now },
        });

        return [activated, healed, true] as const;
      },
    );

    if (categoryActivated > 0 || categoryHealed > 0 || globalActivated) {
      this.logger.log(
        `Commission auto-activate (categoryActivated=${categoryActivated}, categoryHealedDuplicateActive=${categoryHealed}, global=${globalActivated ? 1 : 0}, cutoff=${cutoff.toISOString()}, minutes=${minutes})`,
      );
    }
  }
}
