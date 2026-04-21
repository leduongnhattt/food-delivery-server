import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import {
  EnterpriseLedgerEntryMoneyFlow,
  EnterpriseLedgerEntryStatus,
  EnterpriseLedgerEntryType,
  EnterprisePayoutRequestStatus,
  Prisma,
} from '@prisma/client';
import { asPositiveInt, asTrimmedString } from '@common/utils/parse.utils';

function parseIsoDateOrNull(v: string | undefined): Date | null {
  const dateText = (v ?? '').trim();
  if (!dateText) return null;
  const parsedDate = new Date(dateText);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function findSettlementRangeWhere(enterpriseId: string, now: Date): Prisma.SettlementWhereInput {
  return {
    EnterpriseID: enterpriseId,
    PeriodStart: { lte: now },
    PeriodEnd: { gte: now },
  };
}

function currencyForEnterprise(): string {
  return 'USD';
}

type TxListParams = {
  from?: string;
  to?: string;
  moneyFlow?: string;
  types?: string;
  searchOrderId?: string;
  limit?: string;
  cursor?: string;
};

@Injectable()
export class EnterpriseIncomeService {
  constructor(private readonly prisma: PrismaService) {}

  private async getEnterpriseIdByAccountId(accountId: string): Promise<string> {
    const row = await this.prisma.enterprise.findFirst({
      where: { AccountID: accountId, DeletedAt: null },
      select: { EnterpriseID: true },
    });
    if (!row) throw new NotFoundException('Enterprise not found');
    return row.EnterpriseID;
  }

  async getSummary(accountId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const now = new Date();
    const periodStart = startOfMonth(now);
    const periodEnd = endOfMonth(now);

    const [settlement, payoutSettings, payoutDestinations] = await Promise.all([
      this.prisma.settlement.findFirst({
        where: findSettlementRangeWhere(enterpriseId, now),
        select: {
          SettlementID: true,
          NetPayout: true,
          PaidAt: true,
          Status: true,
          PeriodStart: true,
          PeriodEnd: true,
        },
      }),
      this.prisma.enterprisePayoutSettings.findUnique({
        where: { EnterpriseID: enterpriseId },
        include: { preferredDestination: true },
      }),
      this.prisma.enterprisePayoutDestination.findMany({
        where: { EnterpriseID: enterpriseId, IsActive: true },
        orderBy: [{ IsDefault: 'desc' }, { CreatedAt: 'desc' }],
        take: 10,
      }),
    ]);

    const preferred =
      payoutSettings?.preferredDestination ??
      payoutDestinations.find((d) => d.IsDefault) ??
      payoutDestinations[0] ??
      null;

    const currency = currencyForEnterprise();
    const netPayout = settlement?.NetPayout != null ? Number(settlement.NetPayout) : 0;

    const activeStates: EnterprisePayoutRequestStatus[] = [
      EnterprisePayoutRequestStatus.Pending,
      EnterprisePayoutRequestStatus.Approved,
      EnterprisePayoutRequestStatus.Processing,
    ];
    const hasActiveRequest = settlement
      ? !!(await this.prisma.enterprisePayoutRequest.findFirst({
          where: {
            EnterpriseID: enterpriseId,
            SettlementID: settlement.SettlementID,
            Status: { in: activeStates },
            ExpiresAt: { gt: now },
          },
          select: { PayoutRequestID: true },
        }))
      : false;

    const balance = hasActiveRequest ? 0 : netPayout;
    const canWithdraw = Boolean(
      settlement &&
        !settlement.PaidAt &&
        balance > 0 &&
        preferred &&
        preferred.IsActive === true,
    );

    return {
      success: true,
      currency,
      period: {
        start: (settlement?.PeriodStart ?? periodStart).toISOString(),
        end: (settlement?.PeriodEnd ?? periodEnd).toISOString(),
      },
      settlement: settlement
        ? {
            id: settlement.SettlementID,
            status: String(settlement.Status),
            paidAt: settlement.PaidAt ? settlement.PaidAt.toISOString() : null,
          }
        : null,
      balance,
      defaultPayoutDestination: preferred
        ? {
            id: preferred.PayoutDestinationID,
            kind: String(preferred.Kind),
            bankName: preferred.BankName ?? null,
            accountNumber: preferred.AccountNumber ?? null,
            walletRef: preferred.WalletRef ?? null,
            walletDisplayName: preferred.WalletDisplayName ?? null,
          }
        : null,
      canWithdraw,
    };
  }

  async listTransactions(accountId: string, params: TxListParams) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const from = parseIsoDateOrNull(params.from);
    const to = parseIsoDateOrNull(params.to);

    const mfRaw = (params.moneyFlow ?? '').trim();
    const moneyFlow =
      mfRaw === 'in'
        ? EnterpriseLedgerEntryMoneyFlow.In
        : mfRaw === 'out'
          ? EnterpriseLedgerEntryMoneyFlow.Out
          : null;

    const typeSet = new Set(
      (params.types ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    );
    const allowedTypes = Object.values(EnterpriseLedgerEntryType) as EnterpriseLedgerEntryType[];
    const allowedTypesSet = new Set<string>(allowedTypes);
    const types = [...typeSet].filter((t): t is EnterpriseLedgerEntryType =>
      allowedTypesSet.has(t),
    );

    const q = asTrimmedString(params.searchOrderId)?.toLowerCase() ?? null;
    const limit = Math.min(100, asPositiveInt(params.limit) ?? 50);
    const cursor = asTrimmedString(params.cursor);

    const where: Prisma.EnterpriseLedgerEntryWhereInput = {
      EnterpriseID: enterpriseId,
      ...(from || to
        ? {
            CreatedAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(moneyFlow ? { MoneyFlow: moneyFlow } : {}),
      ...(types.length > 0 ? { Type: { in: types } } : {}),
      ...(q
        ? {
            OR: [
              { ReferenceType: { equals: 'Order' }, ReferenceID: { contains: q } },
              { Description: { contains: q } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.enterpriseLedgerEntry.findMany({
      where,
      orderBy: { CreatedAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { LedgerEntryID: cursor } } : {}),
    });

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? sliced[sliced.length - 1]?.LedgerEntryID ?? null : null;

    return {
      success: true,
      nextCursor,
      transactions: sliced.map((r) => ({
        id: r.LedgerEntryID,
        createdAt: r.CreatedAt.toISOString(),
        transactionType: String(r.Type),
        description: r.Description ?? '',
        referenceId: r.ReferenceID ?? null,
        moneyFlow: r.MoneyFlow === EnterpriseLedgerEntryMoneyFlow.In ? 'in' : 'out',
        amount: Number(r.Amount),
        status: String(r.Status),
        metadata: r.Metadata ?? null,
      })),
    };
  }

  async createWithdrawRequest(
    accountId: string,
    body: { payoutDestinationId?: unknown; settlementId?: unknown; reason?: unknown },
  ) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const payoutDestinationId = asTrimmedString(body.payoutDestinationId);
    const settlementId = asTrimmedString(body.settlementId);
    const reason = asTrimmedString(body.reason);

    const now = new Date();
    const currency = currencyForEnterprise();

    const settlement =
      settlementId
        ? await this.prisma.settlement.findFirst({
            where: { SettlementID: settlementId, EnterpriseID: enterpriseId },
            select: { SettlementID: true, NetPayout: true, PaidAt: true },
          })
        : await this.prisma.settlement.findFirst({
            where: findSettlementRangeWhere(enterpriseId, now),
            select: { SettlementID: true, NetPayout: true, PaidAt: true },
          });

    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.PaidAt) throw new ConflictException('Settlement is already paid');

    const net = settlement.NetPayout != null ? Number(settlement.NetPayout) : 0;
    if (!(net > 0)) throw new ConflictException('No available payout balance');

    const destination = payoutDestinationId
      ? await this.prisma.enterprisePayoutDestination.findFirst({
          where: { PayoutDestinationID: payoutDestinationId, EnterpriseID: enterpriseId },
        })
      : await this.prisma.enterprisePayoutDestination.findFirst({
          where: { EnterpriseID: enterpriseId, IsActive: true, IsDefault: true },
          orderBy: { CreatedAt: 'desc' },
        });

    if (!destination) throw new BadRequestException('No payout destination selected');
    if (!destination.IsActive) throw new ConflictException('Payout destination is inactive');

    const expiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

    const activeStates: EnterprisePayoutRequestStatus[] = [
      EnterprisePayoutRequestStatus.Pending,
      EnterprisePayoutRequestStatus.Approved,
      EnterprisePayoutRequestStatus.Processing,
    ];

    const created = await this.prisma.$transaction(async (tx) => {
      const dup = await tx.enterprisePayoutRequest.findFirst({
        where: {
          EnterpriseID: enterpriseId,
          SettlementID: settlement.SettlementID,
          Status: { in: activeStates },
          ExpiresAt: { gt: now },
        },
        select: { PayoutRequestID: true },
      });
      if (dup) throw new ConflictException('A withdraw request already exists for this settlement');

      const req = await tx.enterprisePayoutRequest.create({
        data: {
          EnterpriseID: enterpriseId,
          RequestedByAccountID: accountId,
          PayoutDestinationID: destination.PayoutDestinationID,
          SettlementID: settlement.SettlementID,
          Amount: new Prisma.Decimal(net),
          Currency: currency,
          Status: EnterprisePayoutRequestStatus.Pending,
          Reason: reason,
          ExpiresAt: expiresAt,
        },
        select: { PayoutRequestID: true, Status: true, ExpiresAt: true, CreatedAt: true },
      });

      await tx.enterpriseLedgerEntry.create({
        data: {
          EnterpriseID: enterpriseId,
          Type: EnterpriseLedgerEntryType.Withdrawal,
          MoneyFlow: EnterpriseLedgerEntryMoneyFlow.Out,
          Amount: new Prisma.Decimal(net),
          Currency: currency,
          Status: EnterpriseLedgerEntryStatus.Pending,
          Description: 'Withdrawal request',
          ReferenceType: 'PayoutRequest',
          ReferenceID: req.PayoutRequestID,
          PayoutRequestID: req.PayoutRequestID,
          Metadata: { expiresAt: req.ExpiresAt.toISOString() },
        },
      });

      return req;
    });

    return {
      success: true,
      payoutRequest: {
        id: created.PayoutRequestID,
        status: String(created.Status),
        createdAt: created.CreatedAt.toISOString(),
        expiresAt: created.ExpiresAt.toISOString(),
      },
    };
  }
}

