import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PaymentMethod } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

function getActivateAfterMinutes(): number {
  const raw = process.env.FINANCE_RULE_AUTO_ACTIVATE_AFTER_MINUTES;
  const n = raw ? Number(raw) : 10;
  if (!Number.isFinite(n) || n <= 0) return 10;
  return n;
}

function channelDedupeKey(method: PaymentMethod, providerCode: string | null): string {
  return `${method}\0${providerCode ?? ''}`;
}

@Injectable()
export class TransactionFeeAutoActivateJob {
  private readonly logger = new Logger(TransactionFeeAutoActivateJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Auto-activate pending transaction fee rules after a short review window.
   *
   * - Global: activates the most recent eligible pending rule and ensures only one global is active.
   * - Channel rules: at most one active rule per `(PaymentMethod, PaymentProviderCode)` (same as admin PATCH).
   *
   * Also reconciles duplicate Active rows per channel (legacy bulk-activate), keeping the rule with
   * latest `EffectiveFrom` then `CreatedAt`.
   *
   * Runs every 10 minutes; eligibility is based on `EffectiveFrom` (start reached) and a short
   * "cooldown" based on `CreatedAt` (defaults to 10 minutes).
   */
  @Cron('*/10 * * * *')
  async runEveryTenMinutes(): Promise<void> {
    const minutes = getActivateAfterMinutes();
    const now = new Date();
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    const [channelActivated, channelHealed, globalActivated] = await this.prisma.$transaction(
      async (tx) => {
        const eligibleChannel = await tx.transactionFeeRule.findMany({
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
            { PaymentMethod: 'asc' },
            { PaymentProviderCode: 'asc' },
            { EffectiveFrom: 'desc' },
            { CreatedAt: 'desc' },
          ],
          select: {
            FeeID: true,
            PaymentMethod: true,
            PaymentProviderCode: true,
          },
        });

        let activated = 0;
        let lastChannelKey: string | null = null;
        for (const r of eligibleChannel) {
          const key = channelDedupeKey(r.PaymentMethod, r.PaymentProviderCode);
          if (key === lastChannelKey) continue;
          lastChannelKey = key;

          await tx.transactionFeeRule.updateMany({
            where: {
              PaymentMethod: r.PaymentMethod,
              PaymentProviderCode: r.PaymentProviderCode,
              DeletedAt: null,
              ExpiredAt: null,
              IsActive: true,
              NOT: { FeeID: r.FeeID },
            },
            data: { IsActive: false },
          });
          await tx.transactionFeeRule.update({
            where: { FeeID: r.FeeID },
            data: { IsActive: true, ActivatedAt: now },
          });
          activated += 1;
        }

        const activeSameWindow = await tx.transactionFeeRule.findMany({
          where: {
            DeletedAt: null,
            ExpiredAt: null,
            IsActive: true,
            OR: [{ EffectiveTo: null }, { EffectiveTo: { gte: now } }],
          },
          orderBy: [
            { PaymentMethod: 'asc' },
            { PaymentProviderCode: 'asc' },
            { EffectiveFrom: 'desc' },
            { CreatedAt: 'desc' },
          ],
          select: {
            FeeID: true,
            PaymentMethod: true,
            PaymentProviderCode: true,
          },
        });

        let healed = 0;
        let lastKeyHeal: string | null = null;
        for (const r of activeSameWindow) {
          const key = channelDedupeKey(r.PaymentMethod, r.PaymentProviderCode);
          if (key !== lastKeyHeal) {
            lastKeyHeal = key;
            continue;
          }
          await tx.transactionFeeRule.update({
            where: { FeeID: r.FeeID },
            data: { IsActive: false },
          });
          healed += 1;
        }

        const eligibleGlobal = await tx.transactionFeeGlobalRule.findFirst({
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

        await tx.transactionFeeGlobalRule.updateMany({
          where: { DeletedAt: null, IsActive: true },
          data: { IsActive: false },
        });
        await tx.transactionFeeGlobalRule.update({
          where: { RuleID: eligibleGlobal.RuleID },
          data: { IsActive: true, ActivatedAt: now },
        });

        return [activated, healed, true] as const;
      },
    );

    if (channelActivated > 0 || channelHealed > 0 || globalActivated) {
      this.logger.log(
        `Transaction fee auto-activate (channelActivated=${channelActivated}, channelHealedDuplicateActive=${channelHealed}, global=${globalActivated ? 1 : 0}, cutoff=${cutoff.toISOString()}, minutes=${minutes})`,
      );
    }
  }
}
