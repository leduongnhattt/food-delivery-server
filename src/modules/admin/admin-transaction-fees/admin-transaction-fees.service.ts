import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { asBoolean, asTrimmedString } from '@common/utils/parse.utils';
import {
  parseChannelFilterToken,
  parseUiPaymentChannelToDb,
  paymentChannelLabel,
  type TransactionFeeChannelFilterToken,
} from './transaction-fee-channel.utils';

function mapGlobalRuleRow(r: {
  RuleID: string;
  RuleName: string | null;
  RatePercent: Prisma.Decimal;
  IsActive: boolean;
  ActivatedAt: Date | null;
  EffectiveFrom: Date;
  EffectiveTo: Date | null;
  CreatedAt: Date;
  UpdatedAt: Date | null;
  updatedBy: { account: { Username: string; Email: string } | null } | null;
}) {
  const u = r.updatedBy?.account;
  return {
    RuleID: r.RuleID,
    RuleName: r.RuleName,
    RatePercent: Number(r.RatePercent),
    IsActive: r.IsActive,
    ActivatedAt: r.ActivatedAt ? r.ActivatedAt.toISOString() : null,
    EffectiveFrom: toDateOnlyString(r.EffectiveFrom),
    EffectiveTo: r.EffectiveTo ? toDateOnlyString(r.EffectiveTo) : null,
    CreatedAt: r.CreatedAt.toISOString(),
    UpdatedAt: r.UpdatedAt?.toISOString() ?? null,
    UpdatedByLabel: u?.Email || u?.Username || null,
  };
}

function parseRatePercent(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0 || value > 100) {
      throw new BadRequestException('ratePercent must be between 0 and 100');
    }
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new BadRequestException('ratePercent must be between 0 and 100');
    }
    return Math.round(n * 100) / 100;
  }
  throw new BadRequestException('ratePercent is required');
}

function parseDateOnlyStart(value: unknown): Date | null {
  const s = asTrimmedString(value);
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Invalid date value');
  }
  return d;
}

function parseDateOnlyEnd(value: unknown): Date | null {
  const s = asTrimmedString(value);
  if (!s) return null;
  const d = new Date(`${s}T23:59:59.999Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Invalid date value');
  }
  return d;
}

function parseDateOnlyRequired(value: unknown, field: string): Date {
  const s = asTrimmedString(value);
  if (!s) throw new BadRequestException(`${field} is required`);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return d;
}

function parseOptionalDateTime(value: unknown): Date | null {
  const s = asTrimmedString(value);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Invalid date value');
  }
  return d;
}

function todayDateOnlyUtc(): Date {
  const t = new Date();
  return new Date(`${t.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function addDaysUtc(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function toDateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
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

function mapFeeRow(r: {
  FeeID: string;
  FeeName: string;
  PaymentMethod: PaymentMethod;
  PaymentProviderCode: string | null;
  RatePercent: Prisma.Decimal;
  IsActive: boolean;
  ActivatedAt: Date | null;
  EffectiveFrom: Date;
  EffectiveTo: Date | null;
  CreatedAt: Date;
  updatedBy: {
    account: { Username: string; Email: string } | null;
  } | null;
}) {
  const u = r.updatedBy?.account;
  return {
    FeeID: r.FeeID,
    FeeName: r.FeeName,
    PaymentMethod: r.PaymentMethod,
    PaymentProviderCode: r.PaymentProviderCode,
    PaymentChannelLabel: paymentChannelLabel(
      r.PaymentMethod,
      r.PaymentProviderCode,
    ),
    RatePercent: Number(r.RatePercent),
    IsActive: r.IsActive,
    ActivatedAt: r.ActivatedAt ? r.ActivatedAt.toISOString() : null,
    EffectiveFrom: toDateOnlyString(r.EffectiveFrom),
    EffectiveTo: r.EffectiveTo ? toDateOnlyString(r.EffectiveTo) : null,
    CreatedAt: r.CreatedAt.toISOString().slice(0, 10),
    UpdatedByLabel: u?.Email || u?.Username || null,
  };
}

@Injectable()
export class AdminTransactionFeesService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getActiveGlobalRule() {
    const row = await this.prisma.transactionFeeGlobalRule.findFirst({
      where: { DeletedAt: null, IsActive: true },
      orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
      select: {
        RuleID: true,
        RuleName: true,
        RatePercent: true,
        IsActive: true,
        ActivatedAt: true,
        EffectiveFrom: true,
        EffectiveTo: true,
        CreatedAt: true,
        UpdatedAt: true,
        updatedBy: {
          select: { account: { select: { Username: true, Email: true } } },
        },
      },
    });
    return row ? mapGlobalRuleRow(row) : null;
  }

  async listGlobalRules() {
    const rows = await this.prisma.transactionFeeGlobalRule.findMany({
      where: { DeletedAt: null },
      orderBy: [{ IsActive: 'desc' }, { EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
      select: {
        RuleID: true,
        RuleName: true,
        RatePercent: true,
        IsActive: true,
        ActivatedAt: true,
        EffectiveFrom: true,
        EffectiveTo: true,
        CreatedAt: true,
        UpdatedAt: true,
        updatedBy: {
          select: { account: { select: { Username: true, Email: true } } },
        },
      },
    });
    return { items: rows.map((r) => mapGlobalRuleRow(r)) };
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
    opts?: { forceActivate?: boolean },
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
          // Always create as Pending; activation is manual or via cronjob.
          IsActive: false,
          ActivatedAt: null,
          EffectiveFrom: effectiveFrom,
          EffectiveTo: effectiveTo,
          DeletedAt: null,
          createdBy: { connect: { AdminID: adminId } },
          updatedBy: { connect: { AdminID: adminId } },
        },
        select: {
          RuleID: true,
          RuleName: true,
          RatePercent: true,
          IsActive: true,
          ActivatedAt: true,
          EffectiveFrom: true,
          EffectiveTo: true,
          CreatedAt: true,
          UpdatedAt: true,
          updatedBy: {
            select: { account: { select: { Username: true, Email: true } } },
          },
        },
      });
    });

    return { success: true as const, item: mapGlobalRuleRow(created) };
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
      select: { RuleID: true, DeletedAt: true, EffectiveFrom: true, EffectiveTo: true, ActivatedAt: true },
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
    if (mergedFrom.getTime() < minFrom.getTime()) {
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

    if (body.isActive !== undefined) {
      const b = asBoolean(body.isActive);
      if (b === null) throw new BadRequestException('isActive must be a boolean');
      if (!existing.ActivatedAt) {
        if (b === false) throw new BadRequestException('Cannot set Pending rule to Inactive');
        data.ActivatedAt = new Date();
      }
      data.IsActive = b;
    }

    const updated = await this.prisma.transactionFeeGlobalRule.update({
      where: { RuleID: id },
      data,
      select: {
        RuleID: true,
        RuleName: true,
        RatePercent: true,
        IsActive: true,
        ActivatedAt: true,
        EffectiveFrom: true,
        EffectiveTo: true,
        CreatedAt: true,
        UpdatedAt: true,
        updatedBy: {
          select: { account: { select: { Username: true, Email: true } } },
        },
      },
    });
    return { success: true as const, item: mapGlobalRuleRow(updated) };
  }

  async activateGlobalRule(accountId: string, ruleId: string) {
    const adminId = await this.requireAdminId(accountId);
    const id = asTrimmedString(ruleId);
    if (!id) throw new BadRequestException('ruleId is required');

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.transactionFeeGlobalRule.findUnique({
        where: { RuleID: id },
        select: { RuleID: true, DeletedAt: true },
      });
      if (!row || row.DeletedAt) throw new NotFoundException('Global rule not found');

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
        select: {
          RuleID: true,
          RuleName: true,
          RatePercent: true,
          IsActive: true,
          ActivatedAt: true,
          EffectiveFrom: true,
          EffectiveTo: true,
          CreatedAt: true,
          UpdatedAt: true,
          updatedBy: {
            select: { account: { select: { Username: true, Email: true } } },
          },
        },
      });
    });

    return { success: true as const, item: mapGlobalRuleRow(updated) };
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
    } else if (status === 'Active') {
      where.ActivatedAt = { not: null };
      where.IsActive = true;
    } else if (status === 'Inactive') {
      where.ActivatedAt = { not: null };
      where.IsActive = false;
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

    const q = params.search?.trim();
    if (q) {
      where.OR = [{ FeeName: { contains: q } }];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.transactionFeeRule.count({ where }),
      this.prisma.transactionFeeRule.findMany({
        where,
        orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
        skip,
        take: pageSize,
        select: {
          FeeID: true,
          FeeName: true,
          PaymentMethod: true,
          PaymentProviderCode: true,
          RatePercent: true,
          IsActive: true,
          ActivatedAt: true,
          EffectiveFrom: true,
          EffectiveTo: true,
          CreatedAt: true,
          updatedBy: {
            select: {
              account: { select: { Username: true, Email: true } },
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((r) => mapFeeRow(r)),
      total,
      page,
      pageSize,
    };
  }

  async getChannelRule(feeId: string) {
    const id = asTrimmedString(feeId);
    if (!id) throw new BadRequestException('feeId is required');

    const row = await this.prisma.transactionFeeRule.findUnique({
      where: { FeeID: id },
      select: {
        FeeID: true,
        FeeName: true,
        PaymentMethod: true,
        PaymentProviderCode: true,
        RatePercent: true,
        IsActive: true,
        ActivatedAt: true,
        EffectiveFrom: true,
        EffectiveTo: true,
        CreatedAt: true,
        DeletedAt: true,
        updatedBy: {
          select: {
            account: { select: { Username: true, Email: true } },
          },
        },
      },
    });
    if (!row || row.DeletedAt) {
      throw new NotFoundException('Transaction fee rule not found');
    }
    return mapFeeRow(row);
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

    await this.assertNoDuplicateRule(method, normalizedProvider, effectiveFrom);

    try {
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
        select: {
          FeeID: true,
          FeeName: true,
          PaymentMethod: true,
          PaymentProviderCode: true,
          RatePercent: true,
          IsActive: true,
          ActivatedAt: true,
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
      return { success: true as const, item: mapFeeRow(created) };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'A rule with this channel and effective start already exists',
        );
      }
      throw e;
    }
  }

  private async assertNoDuplicateRule(
    method: PaymentMethod,
    providerCode: string | null,
    effectiveFrom: Date,
    excludeFeeId?: string,
  ) {
    const dup = await this.prisma.transactionFeeRule.findFirst({
      where: {
        PaymentMethod: method,
        PaymentProviderCode: providerCode,
        EffectiveFrom: effectiveFrom,
        DeletedAt: null,
        ...(excludeFeeId ? { NOT: { FeeID: excludeFeeId } } : {}),
      },
      select: { FeeID: true },
    });
    if (dup) {
      throw new ConflictException(
        'A rule with this channel and effective start already exists',
      );
    }
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
    const id = asTrimmedString(feeId);
    if (!id) throw new BadRequestException('feeId is required');

    const existing = await this.prisma.transactionFeeRule.findUnique({
      where: { FeeID: id },
      select: {
        FeeID: true,
        PaymentMethod: true,
        PaymentProviderCode: true,
        ActivatedAt: true,
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

    let mergedMethod = existing.PaymentMethod;
    let mergedProvider =
      existing.PaymentProviderCode == null ||
      existing.PaymentProviderCode === ''
        ? null
        : existing.PaymentProviderCode.trim().toLowerCase();

    if (body.paymentChannel !== undefined) {
      const ch = asTrimmedString(body.paymentChannel);
      if (!ch) throw new BadRequestException('paymentChannel is invalid');
      const mapped = parseUiPaymentChannelToDb(ch);
      mergedMethod = mapped.method;
      mergedProvider =
        mapped.providerCode == null || mapped.providerCode === ''
          ? null
          : mapped.providerCode.trim().toLowerCase();
      data.PaymentMethod = mergedMethod;
      data.PaymentProviderCode = mergedProvider;
    }

    if (body.feeName !== undefined) {
      const name = asTrimmedString(body.feeName);
      if (!name) throw new BadRequestException('feeName is invalid');
      data.FeeName = name;
    }

    if (body.ratePercent !== undefined) {
      data.RatePercent = new Prisma.Decimal(parseRatePercent(body.ratePercent));
    }

    if (body.isActive !== undefined) {
      const b = asBoolean(body.isActive);
      if (b === null)
        throw new BadRequestException('isActive must be a boolean');
      if (!existing.ActivatedAt) {
        if (b === false) {
          throw new BadRequestException('Cannot set Pending rule to Inactive');
        }
        data.ActivatedAt = new Date();
      }
      data.IsActive = b;
    }

    let mergedEffectiveFrom = existing.EffectiveFrom;
    if (body.effectiveFrom !== undefined) {
      const d = parseDateOnlyRequired(body.effectiveFrom, 'effectiveFrom');
      data.EffectiveFrom = d;
      mergedEffectiveFrom = d;
    }

    const minFrom = todayDateOnlyUtc();
    if (mergedEffectiveFrom.getTime() < minFrom.getTime()) {
      throw new BadRequestException('effectiveFrom cannot be in the past');
    }

    let mergedEffectiveTo: Date | null = existing.EffectiveTo;
    if (body.effectiveTo !== undefined) {
      const raw = body.effectiveTo;
      mergedEffectiveTo =
        raw === null || raw === ''
          ? null
          : parseDateOnlyRequired(raw, 'effectiveTo');
    }
    if (!mergedEffectiveTo) mergedEffectiveTo = addDaysUtc(mergedEffectiveFrom, 1);
    if (mergedEffectiveTo.getTime() < mergedEffectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }
    data.EffectiveTo = mergedEffectiveTo;

    await this.assertNoDuplicateRule(
      mergedMethod,
      mergedProvider,
      mergedEffectiveFrom,
      id,
    );

    try {
      const updated = await this.prisma.transactionFeeRule.update({
        where: { FeeID: id },
        data,
        select: {
          FeeID: true,
          FeeName: true,
          PaymentMethod: true,
          PaymentProviderCode: true,
          RatePercent: true,
          IsActive: true,
          ActivatedAt: true,
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
      return { success: true as const, item: mapFeeRow(updated) };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'A rule with this channel and effective start already exists',
        );
      }
      throw e;
    }
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
