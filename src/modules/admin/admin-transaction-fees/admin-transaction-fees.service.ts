import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { asBoolean, asTrimmedString } from '@common/utils/parse.utils';
import {
  addDaysUtc,
  isSameDateOnly,
  parseDateOnlyEnd,
  parseDateOnlyRequired,
  parseDateOnlyStart,
  parsePercentRequired,
  todayDateOnlyUtc,
  toDateOnlyString,
} from '@common/utils/finance-rule.utils';
import {
  parseChannelFilterToken,
  parseUiPaymentChannelToDb,
  paymentChannelLabel,
  type TransactionFeeChannelFilterToken,
} from '@modules/admin/admin-transaction-fees/transaction-fee-channel.utils';

const globalRuleSelect = Prisma.validator<Prisma.TransactionFeeGlobalRuleSelect>()({
  RuleID: true,
  RuleName: true,
  RatePercent: true,
  IsActive: true,
  ActivatedAt: true,
  ExpiredAt: true,
  EffectiveFrom: true,
  EffectiveTo: true,
  CreatedAt: true,
  UpdatedAt: true,
  updatedBy: {
    select: { account: { select: { Username: true, Email: true } } },
  },
});

type GlobalRuleRow = Prisma.TransactionFeeGlobalRuleGetPayload<{
  select: typeof globalRuleSelect;
}>;

function mapGlobalRuleRow(row: GlobalRuleRow) {
  const updatedByAccount = row.updatedBy?.account;
  return {
    RuleID: row.RuleID,
    RuleName: row.RuleName,
    RatePercent: Number(row.RatePercent),
    IsActive: row.IsActive,
    ActivatedAt: row.ActivatedAt ? row.ActivatedAt.toISOString() : null,
    ExpiredAt: row.ExpiredAt ? row.ExpiredAt.toISOString() : null,
    EffectiveFrom: toDateOnlyString(row.EffectiveFrom),
    EffectiveTo: row.EffectiveTo ? toDateOnlyString(row.EffectiveTo) : null,
    CreatedAt: row.CreatedAt.toISOString(),
    UpdatedAt: row.UpdatedAt?.toISOString() ?? null,
    UpdatedByLabel:
      updatedByAccount?.Email || updatedByAccount?.Username || null,
  };
}

function parseRatePercent(value: unknown): number {
  return parsePercentRequired(value, {
    requiredMessage: 'ratePercent is required',
    outOfRangeMessage: 'ratePercent must be between 0 and 100',
  });
}

function channelRuleWhereForFilter(
  token: TransactionFeeChannelFilterToken | null,
): Prisma.TransactionFeeRuleWhereInput | undefined {
  if (!token) return undefined;
  if (token === 'Stripe') {
    return {
      PaymentMethod: PaymentMethod.CreditCard,
      PaymentProviderCode: 'stripe',
    };
  }
  if (token === 'CreditCard') {
    return {
      PaymentMethod: PaymentMethod.CreditCard,
      OR: [{ PaymentProviderCode: null }, { PaymentProviderCode: '' }],
    };
  }
  return {
    PaymentMethod: token as PaymentMethod,
    OR: [{ PaymentProviderCode: null }, { PaymentProviderCode: '' }],
  };
}

function mapFeeRow(row: {
  FeeID: string;
  FeeName: string;
  PaymentMethod: PaymentMethod;
  PaymentProviderCode: string | null;
  RatePercent: Prisma.Decimal;
  IsActive: boolean;
  ActivatedAt: Date | null;
  ExpiredAt?: Date | null;
  EffectiveFrom: Date;
  EffectiveTo: Date | null;
  CreatedAt: Date;
  updatedBy: {
    account: { Username: string; Email: string } | null;
  } | null;
}) {
  const updatedByAccount = row.updatedBy?.account;
  return {
    FeeID: row.FeeID,
    FeeName: row.FeeName,
    PaymentMethod: row.PaymentMethod,
    PaymentProviderCode: row.PaymentProviderCode,
    PaymentChannelLabel: paymentChannelLabel(
      row.PaymentMethod,
      row.PaymentProviderCode,
    ),
    RatePercent: Number(row.RatePercent),
    IsActive: row.IsActive,
    ActivatedAt: row.ActivatedAt ? row.ActivatedAt.toISOString() : null,
    ExpiredAt: row.ExpiredAt ? row.ExpiredAt.toISOString() : null,
    EffectiveFrom: toDateOnlyString(row.EffectiveFrom),
    EffectiveTo: row.EffectiveTo ? toDateOnlyString(row.EffectiveTo) : null,
    CreatedAt: row.CreatedAt.toISOString().slice(0, 10),
    UpdatedByLabel:
      updatedByAccount?.Email || updatedByAccount?.Username || null,
  };
}

const feeRuleSelect = Prisma.validator<Prisma.TransactionFeeRuleSelect>()({
  FeeID: true,
  FeeName: true,
  PaymentMethod: true,
  PaymentProviderCode: true,
  RatePercent: true,
  IsActive: true,
  ActivatedAt: true,
  ExpiredAt: true,
  EffectiveFrom: true,
  EffectiveTo: true,
  CreatedAt: true,
  updatedBy: {
    select: {
      account: { select: { Username: true, Email: true } },
    },
  },
});

type FeeRuleRow = Prisma.TransactionFeeRuleGetPayload<{
  select: typeof feeRuleSelect;
}>;

function normalizeProviderCode(providerCode: string | null): string | null {
  if (providerCode == null) return null;
  const trimmed = providerCode.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function requireTrimmedString(value: unknown, errorMessage: string): string {
  const s = asTrimmedString(value);
  if (!s) throw new BadRequestException(errorMessage);
  return s;
}

/** Sentinel channel identity for global rows merged into channel-rules list (not a real channel). */
const GLOBAL_RULE_LIST_PAYMENT_METHOD = 'Global' as const;
const GLOBAL_RULE_LIST_PAYMENT_PROVIDER_CODE = null;

function mapGlobalRuleToChannelListRow(row: {
  RuleID: string;
  RuleName: string | null;
  RatePercent: Prisma.Decimal;
  IsActive: boolean;
  ActivatedAt: Date | null;
  ExpiredAt?: Date | null;
  EffectiveFrom: Date;
  EffectiveTo: Date | null;
  CreatedAt: Date;
  updatedBy: {
    account: { Username: string; Email: string } | null;
  } | null;
}) {
  const updatedByAccount = row.updatedBy?.account;
  return {
    FeeID: row.RuleID,
    FeeName: row.RuleName?.trim() ? row.RuleName : 'Global Transaction Fee Rule',
    PaymentMethod: GLOBAL_RULE_LIST_PAYMENT_METHOD,
    PaymentProviderCode: GLOBAL_RULE_LIST_PAYMENT_PROVIDER_CODE,
    PaymentChannelLabel: 'Global (platform)',
    RatePercent: Number(row.RatePercent),
    IsActive: row.IsActive,
    ActivatedAt: row.ActivatedAt ? row.ActivatedAt.toISOString() : null,
    ExpiredAt: row.ExpiredAt ? row.ExpiredAt.toISOString() : null,
    EffectiveFrom: toDateOnlyString(row.EffectiveFrom),
    EffectiveTo: row.EffectiveTo ? toDateOnlyString(row.EffectiveTo) : null,
    CreatedAt: row.CreatedAt.toISOString().slice(0, 10),
    UpdatedByLabel:
      updatedByAccount?.Email || updatedByAccount?.Username || null,
    IsGlobal: true as const,
  };
}

/** Sort by effective window (newest first), then created date — used within global-only or channel-only blocks. */
function compareChannelListRows(
  a: { EffectiveFrom: string; CreatedAt: string },
  b: { EffectiveFrom: string; CreatedAt: string },
): number {
  const ef = b.EffectiveFrom.localeCompare(a.EffectiveFrom);
  if (ef !== 0) return ef;
  return b.CreatedAt.localeCompare(a.CreatedAt);
}

@Injectable()
export class AdminTransactionFeesService {
  constructor(private readonly prisma: PrismaService) { }

  private async requireAdminId(accountId: string): Promise<string> {
    const admin = await this.prisma.admin.findUnique({
      where: { AccountID: accountId },
      select: { AdminID: true },
    });
    if (!admin) {
      throw new NotFoundException('Admin profile not found');
    }
    return admin.AdminID;
  }

  private mergeChannelPatch(
    existing: {
      PaymentMethod: PaymentMethod;
      PaymentProviderCode: string | null;
    },
    body: { paymentChannel?: unknown },
    data: Prisma.TransactionFeeRuleUpdateInput,
  ): { mergedMethod: PaymentMethod; mergedProvider: string | null } {
    let mergedMethod = existing.PaymentMethod;
    let mergedProvider = normalizeProviderCode(existing.PaymentProviderCode);

    if (body.paymentChannel === undefined) {
      return { mergedMethod, mergedProvider };
    }

    const paymentChannelInput = requireTrimmedString(
      body.paymentChannel,
      'paymentChannel is invalid',
    );
    const mappedChannel = parseUiPaymentChannelToDb(paymentChannelInput);
    mergedMethod = mappedChannel.method;
    mergedProvider = normalizeProviderCode(mappedChannel.providerCode);
    data.PaymentMethod = mergedMethod;
    data.PaymentProviderCode = mergedProvider;
    return { mergedMethod, mergedProvider };
  }

  private mergeFeeNamePatch(
    body: { feeName?: unknown },
    data: Prisma.TransactionFeeRuleUpdateInput,
  ): void {
    if (body.feeName === undefined) return;
    const feeName = requireTrimmedString(body.feeName, 'feeName is invalid');
    data.FeeName = feeName;
  }

  private mergeRatePercentPatch(
    body: { ratePercent?: unknown },
    data: Prisma.TransactionFeeRuleUpdateInput,
  ): void {
    if (body.ratePercent === undefined) return;
    data.RatePercent = new Prisma.Decimal(parseRatePercent(body.ratePercent));
  }

  private mergeActivationPatch(
    existing: { ActivatedAt: Date | null; ExpiredAt: Date | null; EffectiveTo: Date | null },
    body: { isActive?: unknown },
    data: Prisma.TransactionFeeRuleUpdateInput,
  ): void {
    if (body.isActive === undefined) return;
    const nextIsActive = asBoolean(body.isActive);
    if (nextIsActive === null) throw new BadRequestException('isActive must be a boolean');
    if (nextIsActive === true) {
      if (existing.ExpiredAt) throw new BadRequestException('Rule is expired');
      if (existing.EffectiveTo && existing.EffectiveTo.getTime() < Date.now()) {
        throw new BadRequestException('Rule is expired');
      }
    }
    if (!existing.ActivatedAt) {
      if (nextIsActive === false) {
        throw new BadRequestException('Cannot set Pending rule to Inactive');
      }
      data.ActivatedAt = new Date();
    }
    data.IsActive = nextIsActive;
  }

  private mergeEffectiveWindowPatch(
    existing: { EffectiveFrom: Date; EffectiveTo: Date | null; ActivatedAt: Date | null },
    body: { effectiveFrom?: unknown; effectiveTo?: unknown; isActive?: unknown },
    data: Prisma.TransactionFeeRuleUpdateInput,
  ): { mergedEffectiveFrom: Date; mergedEffectiveTo: Date } {
    let mergedEffectiveFrom = existing.EffectiveFrom;
    if (body.effectiveFrom !== undefined) {
      const nextEffectiveFrom = parseDateOnlyRequired(body.effectiveFrom, 'effectiveFrom');
      data.EffectiveFrom = nextEffectiveFrom;
      mergedEffectiveFrom = nextEffectiveFrom;
    }

    // If admin moves EffectiveFrom to the future, treat it as Pending again.
    const isActiveExplicitlySet = body.isActive !== undefined;
    if (mergedEffectiveFrom.getTime() > Date.now() && !isActiveExplicitlySet) {
      data.IsActive = false;
      data.ActivatedAt = null;
    }

    const minFrom = todayDateOnlyUtc();
    const allowPastExistingStart =
      mergedEffectiveFrom.getTime() < minFrom.getTime() &&
      isSameDateOnly(mergedEffectiveFrom, existing.EffectiveFrom);
    if (mergedEffectiveFrom.getTime() < minFrom.getTime() && !allowPastExistingStart) {
      throw new BadRequestException('effectiveFrom cannot be in the past');
    }

    let mergedEffectiveTo: Date | null = existing.EffectiveTo;
    if (body.effectiveTo !== undefined) {
      const effectiveToRaw = body.effectiveTo;
      mergedEffectiveTo =
        effectiveToRaw === null || effectiveToRaw === ''
          ? null
          : parseDateOnlyRequired(effectiveToRaw, 'effectiveTo');
    }
    if (!mergedEffectiveTo) mergedEffectiveTo = addDaysUtc(mergedEffectiveFrom, 1);
    if (mergedEffectiveTo.getTime() < mergedEffectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }
    data.EffectiveTo = mergedEffectiveTo;

    if (mergedEffectiveTo.getTime() >= Date.now()) {
      data.ExpiredAt = null;
      // If this rule was previously activated (not Pending) and is currently within the effective window,
      // reactivate it automatically when it becomes un-expired.
      if (
        !isActiveExplicitlySet &&
        existing.ActivatedAt &&
        mergedEffectiveFrom.getTime() <= Date.now() &&
        mergedEffectiveFrom.getTime() <= mergedEffectiveTo.getTime()
      ) {
        data.IsActive = true;
      }
    }

    return { mergedEffectiveFrom, mergedEffectiveTo };
  }

  private async deactivateOtherActiveRulesInChannel(
    tx: Prisma.TransactionClient,
    args: {
      feeId: string;
      mergedMethod: PaymentMethod;
      mergedProvider: string | null;
    },
  ): Promise<void> {
    await tx.transactionFeeRule.updateMany({
      where: {
        DeletedAt: null,
        ExpiredAt: null,
        PaymentMethod: args.mergedMethod,
        PaymentProviderCode: args.mergedProvider,
        IsActive: true,
        NOT: { FeeID: args.feeId },
      },
      data: { IsActive: false },
    });
  }

  async getActiveGlobalRule() {
    const row = await this.prisma.transactionFeeGlobalRule.findFirst({
      where: { DeletedAt: null, IsActive: true },
      orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
      select: globalRuleSelect,
    });
    if (!row) return null;
    const mapped = mapGlobalRuleRow(row);
    // API contract: `/admin/finance/transaction-fees/global` returns `DefaultID` for the active row.
    return {
      DefaultID: mapped.RuleID,
      RuleName: mapped.RuleName,
      RatePercent: mapped.RatePercent,
      IsActive: mapped.IsActive,
      ActivatedAt: mapped.ActivatedAt,
      ExpiredAt: mapped.ExpiredAt,
      EffectiveFrom: mapped.EffectiveFrom,
      EffectiveTo: mapped.EffectiveTo,
      CreatedAt: mapped.CreatedAt,
      UpdatedAt: mapped.UpdatedAt,
      UpdatedByLabel: mapped.UpdatedByLabel,
    };
  }

  async listGlobalRules() {
    const rows = await this.prisma.transactionFeeGlobalRule.findMany({
      where: { DeletedAt: null },
      orderBy: [{ IsActive: 'desc' }, { EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
      select: globalRuleSelect,
    });
    return {
      items: rows.map(mapGlobalRuleRow),
    };
  }

  async createGlobalRule(
    accountId: string,
    body: {
      ruleName?: unknown;
      ratePercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    const adminId = await this.requireAdminId(accountId);
    const rate = parseRatePercent(body.ratePercent);
    const ruleName = asTrimmedString(body.ruleName);
    const isActiveRaw = body.isActive === undefined ? null : asBoolean(body.isActive);
    if (body.isActive !== undefined && isActiveRaw === null) {
      throw new BadRequestException('isActive must be a boolean');
    }

    const effectiveFrom = parseDateOnlyRequired(body.effectiveFrom, 'effectiveFrom');
    const minFrom = todayDateOnlyUtc();
    if (effectiveFrom.getTime() < minFrom.getTime()) {
      throw new BadRequestException('effectiveFrom cannot be in the past');
    }
    let effectiveTo =
      body.effectiveTo === undefined || body.effectiveTo === null || body.effectiveTo === ''
        ? null
        : parseDateOnlyRequired(body.effectiveTo, 'effectiveTo');
    if (!effectiveTo) effectiveTo = addDaysUtc(effectiveFrom, 1);
    if (effectiveTo.getTime() < effectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      return tx.transactionFeeGlobalRule.create({
        data: {
          RuleName: ruleName,
          RatePercent: new Prisma.Decimal(rate),
          IsActive: false,
          ActivatedAt: null,
          EffectiveFrom: effectiveFrom,
          EffectiveTo: effectiveTo,
          DeletedAt: null,
          createdBy: { connect: { AdminID: adminId } },
          updatedBy: { connect: { AdminID: adminId } },
        },
        select: globalRuleSelect,
      });
    });

    return {
      success: true as const,
      item: mapGlobalRuleRow(created),
    };
  }

  async updateGlobalRule(
    accountId: string,
    ruleId: string,
    body: {
      ruleName?: unknown;
      ratePercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    const adminId = await this.requireAdminId(accountId);
    const id = asTrimmedString(ruleId);
    if (!id) throw new BadRequestException('ruleId is required');

    const existing = await this.prisma.transactionFeeGlobalRule.findUnique({
      where: { RuleID: id },
      select: { RuleID: true, DeletedAt: true, EffectiveFrom: true, EffectiveTo: true, ActivatedAt: true, ExpiredAt: true },
    });
    if (!existing || existing.DeletedAt) throw new NotFoundException('Global rule not found');

    const data: Prisma.TransactionFeeGlobalRuleUpdateInput = {
      updatedBy: { connect: { AdminID: adminId } },
      DeletedAt: null,
    };
    if (body.ruleName !== undefined) data.RuleName = asTrimmedString(body.ruleName);
    if (body.ratePercent !== undefined) {
      data.RatePercent = new Prisma.Decimal(parseRatePercent(body.ratePercent));
    }
    if (body.effectiveFrom !== undefined) {
      data.EffectiveFrom = parseDateOnlyRequired(body.effectiveFrom, 'effectiveFrom');
    }
    if (body.effectiveTo !== undefined) {
      const raw = body.effectiveTo;
      if (raw === null || raw === '') {
        data.EffectiveTo = null;
      } else {
        data.EffectiveTo = parseDateOnlyRequired(raw, 'effectiveTo');
      }
    }

    const mergedFrom =
      body.effectiveFrom !== undefined
        ? parseDateOnlyRequired(body.effectiveFrom, 'effectiveFrom')
        : existing.EffectiveFrom;
    const minFrom = todayDateOnlyUtc();
    const allowPastExistingStart =
      mergedFrom.getTime() < minFrom.getTime() &&
      isSameDateOnly(mergedFrom, existing.EffectiveFrom);
    if (mergedFrom.getTime() < minFrom.getTime() && !allowPastExistingStart) {
      throw new BadRequestException('effectiveFrom cannot be in the past');
    }
    let mergedTo: Date | null =
      body.effectiveTo !== undefined
        ? body.effectiveTo === null || body.effectiveTo === ''
          ? null
          : parseDateOnlyRequired(body.effectiveTo, 'effectiveTo')
        : existing.EffectiveTo;
    if (!mergedTo) mergedTo = addDaysUtc(mergedFrom, 1);
    if (mergedTo.getTime() < mergedFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }
    data.EffectiveTo = mergedTo;
    if (mergedTo.getTime() >= Date.now()) {
      data.ExpiredAt = null;
    }

    if (body.isActive !== undefined) {
      const nextIsActive = asBoolean(body.isActive);
      if (nextIsActive === null) throw new BadRequestException('isActive must be a boolean');
      if (nextIsActive === true) {
        // Keep one-active invariant: activation must go through the dedicated endpoint.
        throw new BadRequestException('Use activate endpoint to activate a global rule');
      }
      if (!existing.ActivatedAt) {
        if (nextIsActive === false) throw new BadRequestException('Cannot set Pending rule to Inactive');
        data.ActivatedAt = new Date();
      }
      data.IsActive = nextIsActive;
    }

    const updated = await this.prisma.transactionFeeGlobalRule.update({
      where: { RuleID: id },
      data,
      select: globalRuleSelect,
    });
    return {
      success: true as const,
      item: mapGlobalRuleRow(updated),
    };
  }

  async activateGlobalRule(accountId: string, ruleId: string) {
    const adminId = await this.requireAdminId(accountId);
    const id = asTrimmedString(ruleId);
    if (!id) throw new BadRequestException('ruleId is required');

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.transactionFeeGlobalRule.findUnique({
        where: { RuleID: id },
        select: { RuleID: true, DeletedAt: true, ExpiredAt: true, EffectiveTo: true },
      });
      if (!row || row.DeletedAt) throw new NotFoundException('Global rule not found');
      if (row.ExpiredAt) throw new BadRequestException('Rule is expired');
      if (row.EffectiveTo && row.EffectiveTo.getTime() < Date.now()) {
        throw new BadRequestException('Rule is expired');
      }

      await tx.transactionFeeGlobalRule.updateMany({
        where: { DeletedAt: null, IsActive: true },
        data: { IsActive: false },
      });
      return tx.transactionFeeGlobalRule.update({
        where: { RuleID: id },
        data: {
          IsActive: true,
          ActivatedAt: new Date(),
          updatedBy: { connect: { AdminID: adminId } },
        },
        select: globalRuleSelect,
      });
    });

    return {
      success: true as const,
      item: mapGlobalRuleRow(updated),
    };
  }

  async listChannelRules(params: {
    page: number;
    pageSize: number;
    search?: string | null;
    paymentChannel?: TransactionFeeChannelFilterToken | null;
    status?: string | null;
    isActive?: boolean | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.TransactionFeeRuleWhereInput = { DeletedAt: null };

    const ch = channelRuleWhereForFilter(params.paymentChannel ?? null);
    if (ch) {
      Object.assign(where, ch);
    }

    if (params.isActive === true || params.isActive === false) {
      where.IsActive = params.isActive;
    }

    const status = params.status?.trim();
    if (status === 'Pending') {
      where.ActivatedAt = null;
      where.ExpiredAt = null;
    } else if (status === 'Active') {
      where.ActivatedAt = { not: null };
      where.ExpiredAt = null;
      where.IsActive = true;
    } else if (status === 'Inactive') {
      where.ActivatedAt = { not: null };
      where.ExpiredAt = null;
      where.IsActive = false;
    } else if (status === 'Expired') {
      where.ExpiredAt = { not: null };
    }

    const filterFrom = params.effectiveFrom
      ? parseDateOnlyStart(params.effectiveFrom)
      : null;
    const filterTo = params.effectiveTo
      ? parseDateOnlyEnd(params.effectiveTo)
      : null;
    if (filterFrom || filterTo) {
      const and: Prisma.TransactionFeeRuleWhereInput[] = [];
      if (filterFrom) and.push({ EffectiveFrom: { gte: filterFrom } });
      if (filterTo) and.push({ EffectiveFrom: { lte: filterTo } });
      where.AND = and;
    }

    const searchQuery = params.search?.trim();
    if (searchQuery) {
      where.OR = [{ FeeName: { contains: searchQuery } }];
    }

    const includeGlobalRows = !(params.paymentChannel?.trim());

    const globalWhere: Prisma.TransactionFeeGlobalRuleWhereInput = {
      DeletedAt: null,
    };
    if (includeGlobalRows) {
      if (params.isActive === true || params.isActive === false) {
        globalWhere.IsActive = params.isActive;
      }
      if (status === 'Pending') {
        globalWhere.ActivatedAt = null;
        globalWhere.ExpiredAt = null;
      } else if (status === 'Active') {
        globalWhere.ActivatedAt = { not: null };
        globalWhere.ExpiredAt = null;
        globalWhere.IsActive = true;
      } else if (status === 'Inactive') {
        globalWhere.ActivatedAt = { not: null };
        globalWhere.ExpiredAt = null;
        globalWhere.IsActive = false;
      } else if (status === 'Expired') {
        globalWhere.ExpiredAt = { not: null };
      }
      if (filterFrom || filterTo) {
        const andG: Prisma.TransactionFeeGlobalRuleWhereInput[] = [];
        if (filterFrom) andG.push({ EffectiveFrom: { gte: filterFrom } });
        if (filterTo) andG.push({ EffectiveFrom: { lte: filterTo } });
        globalWhere.AND = andG;
      }
      if (searchQuery) {
        globalWhere.RuleName = { contains: searchQuery };
      }
    }

    const [globalRows, channelRows] = await Promise.all([
      includeGlobalRows
        ? this.prisma.transactionFeeGlobalRule.findMany({
          where: globalWhere,
          orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
          select: globalRuleSelect,
        })
        : Promise.resolve<GlobalRuleRow[]>([]),
      this.prisma.transactionFeeRule.findMany({
        where,
        orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
        select: feeRuleSelect,
      }),
    ]);

    const globalItems = globalRows.map((row) => mapGlobalRuleToChannelListRow(row));
    const channelItems = channelRows.map((row) => mapFeeRow(row));
    // Global rows always precede channel rows in the list (and pagination).
    const merged = [
      ...globalItems.sort(compareChannelListRows),
      ...channelItems.sort(compareChannelListRows),
    ];
    const total = merged.length;
    const items = merged.slice(skip, skip + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async getChannelRule(feeId: string) {
    const id = asTrimmedString(feeId);
    if (!id) throw new BadRequestException('feeId is required');

    const row = await this.prisma.transactionFeeRule.findFirst({
      where: { FeeID: id, DeletedAt: null },
      select: feeRuleSelect,
    });
    if (!row) throw new NotFoundException('Transaction fee rule not found');
    return mapFeeRow(row satisfies FeeRuleRow);
  }

  async createChannelRule(
    accountId: string,
    body: {
      paymentChannel?: unknown;
      feeName?: unknown;
      ratePercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    const adminId = await this.requireAdminId(accountId);
    const channelRaw = asTrimmedString(body.paymentChannel);
    if (!channelRaw) {
      throw new BadRequestException('paymentChannel is required');
    }
    const { method, providerCode } = parseUiPaymentChannelToDb(channelRaw);

    const feeName = asTrimmedString(body.feeName);
    if (!feeName) {
      throw new BadRequestException('feeName is required');
    }

    const effectiveFrom = parseDateOnlyRequired(body.effectiveFrom, 'effectiveFrom');
    const minFrom = todayDateOnlyUtc();
    if (effectiveFrom.getTime() < minFrom.getTime()) {
      throw new BadRequestException('effectiveFrom cannot be in the past');
    }
    let effectiveTo =
      body.effectiveTo === undefined || body.effectiveTo === null || body.effectiveTo === ''
        ? null
        : parseDateOnlyRequired(body.effectiveTo, 'effectiveTo');
    if (!effectiveTo) effectiveTo = addDaysUtc(effectiveFrom, 1);
    if (effectiveTo.getTime() < effectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }

    const rate = parseRatePercent(body.ratePercent);
    // Always create as Pending; activation is manual or via cronjob.
    const activeFlag = false;

    const normalizedProvider =
      providerCode == null || providerCode === ''
        ? null
        : providerCode.trim().toLowerCase();

    const created = await this.prisma.transactionFeeRule.create({
      data: {
        FeeName: feeName,
        PaymentMethod: method,
        PaymentProviderCode: normalizedProvider,
        RatePercent: new Prisma.Decimal(rate),
        IsActive: activeFlag,
        ActivatedAt: null,
        EffectiveFrom: effectiveFrom,
        EffectiveTo: effectiveTo,
        DeletedAt: null,
        createdBy: { connect: { AdminID: adminId } },
        updatedBy: { connect: { AdminID: adminId } },
      },
      select: feeRuleSelect,
    });
    return { success: true as const, item: mapFeeRow(created) };
  }

  async updateChannelRule(
    accountId: string,
    feeId: string,
    body: {
      paymentChannel?: unknown;
      feeName?: unknown;
      ratePercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    const adminId = await this.requireAdminId(accountId);
    const feeIdNormalized = asTrimmedString(feeId);
    if (!feeIdNormalized) throw new BadRequestException('feeId is required');

    const existing = await this.prisma.transactionFeeRule.findUnique({
      where: { FeeID: feeIdNormalized },
      select: {
        FeeID: true,
        PaymentMethod: true,
        PaymentProviderCode: true,
        IsActive: true,
        ActivatedAt: true,
        ExpiredAt: true,
        EffectiveFrom: true,
        EffectiveTo: true,
        DeletedAt: true,
      },
    });
    if (!existing || existing.DeletedAt) {
      throw new NotFoundException('Transaction fee rule not found');
    }

    const data: Prisma.TransactionFeeRuleUpdateInput = {
      updatedBy: { connect: { AdminID: adminId } },
    };

    const { mergedMethod, mergedProvider } = this.mergeChannelPatch(existing, body, data);
    this.mergeFeeNamePatch(body, data);
    this.mergeRatePercentPatch(body, data);
    this.mergeActivationPatch(existing, body, data);
    this.mergeEffectiveWindowPatch(existing, body, data);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (data.IsActive === true) {
        await this.deactivateOtherActiveRulesInChannel(tx, {
          feeId: feeIdNormalized,
          mergedMethod,
          mergedProvider,
        });
      }

      return tx.transactionFeeRule.update({
        where: { FeeID: feeIdNormalized },
        data,
        select: {
          FeeID: true,
          FeeName: true,
          PaymentMethod: true,
          PaymentProviderCode: true,
          RatePercent: true,
          IsActive: true,
          ActivatedAt: true,
          ExpiredAt: true,
          EffectiveFrom: true,
          EffectiveTo: true,
          CreatedAt: true,
          updatedBy: {
            select: {
              account: { select: { Username: true, Email: true } },
            },
          },
        },
      });
    });

    return { success: true as const, item: mapFeeRow(updated) };
  }

  parseListQuery(input: {
    page?: string;
    pageSize?: string;
    search?: string;
    paymentChannel?: string;
    status?: string;
    isActive?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  }) {
    const page = Math.max(1, parseInt(input.page || '1', 10) || 1);
    const pageSizeRaw = parseInt(input.pageSize || '12', 10) || 12;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
    const search = asTrimmedString(input.search);
    const paymentChannel = parseChannelFilterToken(input.paymentChannel);
    const status = asTrimmedString(input.status);
    const isActiveRaw = asTrimmedString(input.isActive);
    let isActive: boolean | null = null;
    if (isActiveRaw === 'true') isActive = true;
    if (isActiveRaw === 'false') isActive = false;
    const effectiveFrom = asTrimmedString(input.effectiveFrom);
    const effectiveTo = asTrimmedString(input.effectiveTo);
    return {
      page,
      pageSize,
      search,
      paymentChannel,
      status,
      isActive,
      effectiveFrom,
      effectiveTo,
    };
  }
}
