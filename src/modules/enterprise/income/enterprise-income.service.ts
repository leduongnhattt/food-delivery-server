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

function currencyForEnterprise(): string {
  return 'USD';
}

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
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
  private readonly activePayoutRequestStates: EnterprisePayoutRequestStatus[] = [
    EnterprisePayoutRequestStatus.Pending,
    EnterprisePayoutRequestStatus.Approved,
    EnterprisePayoutRequestStatus.Processing,
  ];

  constructor(private readonly prisma: PrismaService) {}

  private async lockedSettlementIds(enterpriseId: string, now: Date): Promise<Set<string>> {
    const locked = new Set<string>();

    const direct = await this.prisma.enterprisePayoutRequest.findMany({
      where: {
        EnterpriseID: enterpriseId,
        Status: { in: this.activePayoutRequestStates },
        ExpiresAt: { gt: now },
        SettlementID: { not: null },
      },
      select: { SettlementID: true },
    });
    for (const r of direct) {
      if (r.SettlementID) locked.add(r.SettlementID);
    }

    const combinedPayouts = await this.prisma.enterprisePayoutRequest.findMany({
      where: {
        EnterpriseID: enterpriseId,
        Status: { in: this.activePayoutRequestStates },
        ExpiresAt: { gt: now },
        SettlementID: null,
      },
      select: { PayoutRequestID: true },
    });
    if (combinedPayouts.length === 0) return locked;

    const payoutIds = combinedPayouts.map((p) => p.PayoutRequestID);
    const ledgers = await this.prisma.enterpriseLedgerEntry.findMany({
      where: {
        EnterpriseID: enterpriseId,
        PayoutRequestID: { in: payoutIds },
        Type: EnterpriseLedgerEntryType.Withdrawal,
      },
      select: { Metadata: true },
    });
    for (const row of ledgers) {
      const meta = row.Metadata as { settlementBreakdown?: { settlementId?: string }[] } | null;
      const breakdown = meta?.settlementBreakdown;
      if (!Array.isArray(breakdown)) continue;
      for (const item of breakdown) {
        const sid = typeof item?.settlementId === 'string' ? item.settlementId.trim() : '';
        if (sid) locked.add(sid);
      }
    }

    return locked;
  }

  /** Unpaid settlement with NetPayout &gt; 0, not locked; prefer period containing `now`, else FIFO by PeriodStart. */
  private pickNextWithdrawableFromList<
    T extends {
      SettlementID: string;
      NetPayout: Prisma.Decimal | null;
      PeriodStart: Date;
      PeriodEnd: Date;
    },
  >(unpaidSettlements: T[], locked: Set<string>, now: Date): T | null {
    const available = unpaidSettlements.filter((s) => {
      if (locked.has(s.SettlementID)) return false;
      const net = s.NetPayout != null ? Number(s.NetPayout) : 0;
      return net > 0;
    });
    const inRange = available.filter(
      (s) => s.PeriodStart.getTime() <= now.getTime() && s.PeriodEnd.getTime() >= now.getTime(),
    );
    return inRange[0] ?? available[0] ?? null;
  }

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
    const calPeriodStart = startOfMonth(now);
    const calPeriodEnd = endOfMonth(now);

    const locked = await this.lockedSettlementIds(enterpriseId, now);

    const [unpaidSettlements, payoutSettings, payoutDestinations] = await Promise.all([
      this.prisma.settlement.findMany({
        where: { EnterpriseID: enterpriseId, PaidAt: null },
        select: {
          SettlementID: true,
          NetPayout: true,
          PaidAt: true,
          Status: true,
          PeriodStart: true,
          PeriodEnd: true,
        },
        orderBy: [{ PeriodStart: 'asc' }, { SettlementID: 'asc' }],
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

    let balance = 0;
    const contributorsPositive: typeof unpaidSettlements = [];
    for (const s of unpaidSettlements) {
      if (locked.has(s.SettlementID)) continue;
      const net = s.NetPayout != null ? Number(s.NetPayout) : 0;
      if (!Number.isFinite(net)) continue;
      balance += net;
      if (net > 0) contributorsPositive.push(s);
    }
    balance = roundMoney2(balance);

    const next = this.pickNextWithdrawableFromList(unpaidSettlements, locked, now);

    const periodBounds =
      contributorsPositive.length > 0
        ? {
            start: new Date(Math.min(...contributorsPositive.map((s) => s.PeriodStart.getTime()))),
            end: new Date(Math.max(...contributorsPositive.map((s) => s.PeriodEnd.getTime()))),
          }
        : next
          ? { start: next.PeriodStart, end: next.PeriodEnd }
          : { start: calPeriodStart, end: calPeriodEnd };

    /** Full balance withdraw aggregates all unlocked settlements — do not tie button to a single settlement. */
    const canWithdraw = Boolean(
      balance > 0 && preferred && preferred.IsActive === true,
    );

    return {
      success: true,
      currency,
      period: {
        start: periodBounds.start.toISOString(),
        end: periodBounds.end.toISOString(),
      },
      settlement: next
        ? {
            id: next.SettlementID,
            status: String(next.Status),
            paidAt: next.PaidAt ? next.PaidAt.toISOString() : null,
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

    const searchQuery = asTrimmedString(params.searchOrderId)?.toLowerCase() ?? null;
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
      ...(searchQuery
        ? {
            OR: [
              { ReferenceType: { equals: 'Order' }, ReferenceID: { contains: searchQuery } },
              { ReferenceType: { equals: 'PayoutRequest' }, ReferenceID: { contains: searchQuery } },
              { Description: { contains: searchQuery } },
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

    const locked = await this.lockedSettlementIds(enterpriseId, now);

    type SettlementWithdrawSlice = {
      SettlementID: string;
      NetPayout: Prisma.Decimal | null;
      PaidAt: Date | null;
    };

    let withdrawableSettlements: SettlementWithdrawSlice[] = [];
    /** Single-settlement withdraw (explicit id). Otherwise aggregate all unlocked unpaid nets (matches summary balance). */
    let payoutSettlementId: string | null = null;

    if (settlementId) {
      const one = await this.prisma.settlement.findFirst({
        where: { SettlementID: settlementId, EnterpriseID: enterpriseId },
        select: { SettlementID: true, NetPayout: true, PaidAt: true },
      });
      if (!one) throw new NotFoundException('Settlement not found');
      if (one.PaidAt) throw new ConflictException('Settlement is already paid');
      if (locked.has(one.SettlementID)) {
        throw new ConflictException('A withdraw request is already in progress for this settlement');
      }
      withdrawableSettlements = [one];
      payoutSettlementId = one.SettlementID;
    } else {
      const unpaidSettlements = await this.prisma.settlement.findMany({
        where: { EnterpriseID: enterpriseId, PaidAt: null },
        select: {
          SettlementID: true,
          NetPayout: true,
          PaidAt: true,
          PeriodStart: true,
          PeriodEnd: true,
        },
        orderBy: [{ PeriodStart: 'asc' }, { SettlementID: 'asc' }],
      });
      withdrawableSettlements = unpaidSettlements.filter((s) => {
        if (locked.has(s.SettlementID)) return false;
        const n = s.NetPayout != null ? Number(s.NetPayout) : 0;
        return Number.isFinite(n) && n > 0;
      });
      // One FK on payout request: attach settlement only when a single row funds this payout.
      payoutSettlementId =
        withdrawableSettlements.length === 1 ? withdrawableSettlements[0].SettlementID : null;
    }

    if (withdrawableSettlements.length === 0) {
      throw new NotFoundException('Settlement not found');
    }

    const totalNet = roundMoney2(
      withdrawableSettlements.reduce((acc, s) => {
        const n = s.NetPayout != null ? Number(s.NetPayout) : 0;
        return acc + (Number.isFinite(n) ? n : 0);
      }, 0),
    );
    if (!(totalNet > 0)) throw new ConflictException('No available payout balance');

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

    const settlementIds = withdrawableSettlements.map((s) => s.SettlementID);

    const created = await this.prisma.$transaction(async (tx) => {
      const dup = await tx.enterprisePayoutRequest.findFirst({
        where: {
          EnterpriseID: enterpriseId,
          OR: [
            { SettlementID: { in: settlementIds } },
            ...(payoutSettlementId === null
              ? ([
                  {
                    EnterpriseID: enterpriseId,
                    SettlementID: null,
                    Status: { in: this.activePayoutRequestStates },
                    ExpiresAt: { gt: now },
                  },
                ] as const)
              : []),
          ],
          Status: { in: this.activePayoutRequestStates },
          ExpiresAt: { gt: now },
        },
        select: { PayoutRequestID: true },
      });
      if (dup) {
        throw new ConflictException(
          'A withdraw request is already in progress for one or more of these settlements',
        );
      }

      const ledgerMetadata: Record<string, unknown> = {
        expiresAt: expiresAt.toISOString(),
        ...(withdrawableSettlements.length > 1
          ? {
              settlementBreakdown: withdrawableSettlements.map((s) => ({
                settlementId: s.SettlementID,
                amount: roundMoney2(Number(s.NetPayout ?? 0)),
              })),
            }
          : {}),
      };

      const req = await tx.enterprisePayoutRequest.create({
        data: {
          EnterpriseID: enterpriseId,
          RequestedByAccountID: accountId,
          PayoutDestinationID: destination.PayoutDestinationID,
          SettlementID: payoutSettlementId,
          Amount: new Prisma.Decimal(totalNet),
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
          Amount: new Prisma.Decimal(totalNet),
          Currency: currency,
          Status: EnterpriseLedgerEntryStatus.Pending,
          Description: 'Withdrawal request',
          ReferenceType: 'PayoutRequest',
          ReferenceID: req.PayoutRequestID,
          PayoutRequestID: req.PayoutRequestID,
          Metadata: { ...ledgerMetadata, expiresAt: req.ExpiresAt.toISOString() },
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

  async getLedgerEntryDetail(accountId: string, ledgerEntryId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const trimmedId = asTrimmedString(ledgerEntryId);
    if (!trimmedId) throw new BadRequestException('Invalid ledger entry id');

    const ledgerRow = await this.prisma.enterpriseLedgerEntry.findFirst({
      where: { LedgerEntryID: trimmedId, EnterpriseID: enterpriseId },
      include: {
        payoutRequest: {
          select: {
            PayoutRequestID: true,
            Status: true,
            Amount: true,
            Currency: true,
            ExpiresAt: true,
            CreatedAt: true,
            Reason: true,
          },
        },
      },
    });
    if (!ledgerRow) throw new NotFoundException('Transaction not found');

    const payout = ledgerRow.payoutRequest;
    const isWithdrawal =
      ledgerRow.Type === EnterpriseLedgerEntryType.Withdrawal &&
      ledgerRow.MoneyFlow === EnterpriseLedgerEntryMoneyFlow.Out;
    const canCancelWithdrawal = Boolean(
      isWithdrawal &&
        ledgerRow.Status === EnterpriseLedgerEntryStatus.Pending &&
        payout &&
        payout.Status === EnterprisePayoutRequestStatus.Pending,
    );

    return {
      success: true,
      entry: {
        id: ledgerRow.LedgerEntryID,
        createdAt: ledgerRow.CreatedAt.toISOString(),
        transactionType: String(ledgerRow.Type),
        description: ledgerRow.Description ?? '',
        referenceType: ledgerRow.ReferenceType ?? null,
        referenceId: ledgerRow.ReferenceID ?? null,
        moneyFlow: ledgerRow.MoneyFlow === EnterpriseLedgerEntryMoneyFlow.In ? 'in' : 'out',
        amount: Number(ledgerRow.Amount),
        status: String(ledgerRow.Status),
        metadata: ledgerRow.Metadata ?? null,
      },
      payoutRequest: payout
        ? {
            id: payout.PayoutRequestID,
            status: String(payout.Status),
            amount: Number(payout.Amount),
            currency: payout.Currency,
            expiresAt: payout.ExpiresAt.toISOString(),
            createdAt: payout.CreatedAt.toISOString(),
            reason: payout.Reason ?? null,
          }
        : null,
      canCancelWithdrawal,
    };
  }

  async cancelPendingWithdrawalByLedgerEntry(accountId: string, ledgerEntryId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const trimmedId = asTrimmedString(ledgerEntryId);
    if (!trimmedId) throw new BadRequestException('Invalid ledger entry id');

    await this.prisma.$transaction(async (tx) => {
      const ledgerRow = await tx.enterpriseLedgerEntry.findFirst({
        where: { LedgerEntryID: trimmedId, EnterpriseID: enterpriseId },
        include: {
          payoutRequest: {
            select: {
              PayoutRequestID: true,
              Status: true,
            },
          },
        },
      });
      if (!ledgerRow) throw new NotFoundException('Transaction not found');

      if (
        ledgerRow.Type !== EnterpriseLedgerEntryType.Withdrawal ||
        ledgerRow.MoneyFlow !== EnterpriseLedgerEntryMoneyFlow.Out
      ) {
        throw new BadRequestException('Only withdrawal transactions can be cancelled this way');
      }
      if (ledgerRow.Status !== EnterpriseLedgerEntryStatus.Pending) {
        throw new ConflictException('This withdrawal can no longer be cancelled');
      }
      if (!ledgerRow.PayoutRequestID || !ledgerRow.payoutRequest) {
        throw new BadRequestException('Withdrawal is not linked to a payout request');
      }
      if (ledgerRow.payoutRequest.Status !== EnterprisePayoutRequestStatus.Pending) {
        throw new ConflictException('The payout request is no longer pending');
      }

      await tx.enterprisePayoutRequest.update({
        where: { PayoutRequestID: ledgerRow.PayoutRequestID },
        data: { Status: EnterprisePayoutRequestStatus.Cancelled },
      });
      await tx.enterpriseLedgerEntry.update({
        where: { LedgerEntryID: ledgerRow.LedgerEntryID },
        data: { Status: EnterpriseLedgerEntryStatus.Cancelled },
      });
    });

    return { success: true };
  }
}

