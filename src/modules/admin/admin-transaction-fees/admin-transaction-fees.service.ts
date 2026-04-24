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

const TRANSACTION_FEE_GLOBAL_DEFAULT_ID =
  '00000000-0000-0000-0000-000000000002';

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

function parseOptionalDateTime(value: unknown): Date | null {
  const s = asTrimmedString(value);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Invalid date value');
  }
  return d;
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

  async getGlobal() {
    let row = await this.prisma.transactionFeeGlobalDefault.findUnique({
      where: { DefaultID: TRANSACTION_FEE_GLOBAL_DEFAULT_ID },
      include: {
        updatedBy: {
          select: {
            account: { select: { Username: true, Email: true } },
          },
        },
      },
    });
    if (!row) {
      row = await this.prisma.transactionFeeGlobalDefault.create({
        data: {
          DefaultID: TRANSACTION_FEE_GLOBAL_DEFAULT_ID,
          RatePercent: new Prisma.Decimal(0),
          RuleName: null,
          IsActive: true,
          EffectiveFrom: new Date(),
          EffectiveTo: null,
        },
        include: {
          updatedBy: {
            select: {
              account: { select: { Username: true, Email: true } },
            },
          },
        },
      });
    }
    const u = row.updatedBy?.account;
    return {
      DefaultID: row.DefaultID,
      RuleName: row.RuleName,
      RatePercent: Number(row.RatePercent),
      IsActive: row.IsActive,
      EffectiveFrom: toDateOnlyString(row.EffectiveFrom),
      EffectiveTo: row.EffectiveTo ? toDateOnlyString(row.EffectiveTo) : null,
      CreatedAt: row.CreatedAt.toISOString(),
      UpdatedAt: row.UpdatedAt?.toISOString() ?? null,
      UpdatedByLabel: u?.Email || u?.Username || null,
    };
  }

  async updateGlobal(
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
    await this.getGlobal();

    const existing = await this.prisma.transactionFeeGlobalDefault.findUnique({
      where: { DefaultID: TRANSACTION_FEE_GLOBAL_DEFAULT_ID },
      select: {
        EffectiveFrom: true,
        EffectiveTo: true,
        RatePercent: true,
      },
    });
    if (!existing)
      throw new NotFoundException('Global transaction fee not found');

    const data: Prisma.TransactionFeeGlobalDefaultUpdateInput = {
      updatedBy: { connect: { AdminID: adminId } },
    };

    if (body.ratePercent !== undefined) {
      data.RatePercent = new Prisma.Decimal(parseRatePercent(body.ratePercent));
    }
    if (body.ruleName !== undefined) {
      data.RuleName = asTrimmedString(body.ruleName);
    }
    if (body.isActive !== undefined) {
      const b = asBoolean(body.isActive);
      if (b === null)
        throw new BadRequestException('isActive must be a boolean');
      data.IsActive = b;
    }

    let mergedFrom = existing.EffectiveFrom;
    if (body.effectiveFrom !== undefined) {
      const d = parseOptionalDateTime(body.effectiveFrom);
      if (!d) throw new BadRequestException('effectiveFrom is invalid');
      data.EffectiveFrom = d;
      mergedFrom = d;
    }

    let mergedTo: Date | null = existing.EffectiveTo;
    if (body.effectiveTo !== undefined) {
      const raw = body.effectiveTo;
      if (raw === null || raw === '') {
        data.EffectiveTo = null;
        mergedTo = null;
      } else {
        const d = parseOptionalDateTime(raw);
        if (!d) throw new BadRequestException('effectiveTo is invalid');
        data.EffectiveTo = d;
        mergedTo = d;
      }
    }

    if (mergedTo && mergedTo.getTime() < mergedFrom.getTime()) {
      throw new BadRequestException(
        'effectiveTo must be on or after effectiveFrom',
      );
    }

    const row = await this.prisma.transactionFeeGlobalDefault.update({
      where: { DefaultID: TRANSACTION_FEE_GLOBAL_DEFAULT_ID },
      data,
    });

    return {
      success: true as const,
      DefaultID: row.DefaultID,
      RatePercent: Number(row.RatePercent),
    };
  }

  async listChannelRules(params: {
    page: number;
    pageSize: number;
    search?: string | null;
    paymentChannel?: TransactionFeeChannelFilterToken | null;
    isActive?: boolean | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.TransactionFeeRuleWhereInput = {};

    const ch = channelRuleWhereForFilter(params.paymentChannel ?? null);
    if (ch) {
      Object.assign(where, ch);
    }

    if (params.isActive === true || params.isActive === false) {
      where.IsActive = params.isActive;
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
    if (!row) throw new NotFoundException('Transaction fee rule not found');
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

    const effectiveFrom = parseOptionalDateTime(body.effectiveFrom);
    if (!effectiveFrom) {
      throw new BadRequestException('effectiveFrom is required');
    }

    const effectiveTo = parseOptionalDateTime(body.effectiveTo);
    if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
      throw new BadRequestException(
        'effectiveTo must be on or after effectiveFrom',
      );
    }

    const rate = parseRatePercent(body.ratePercent);
    const isActiveB = asBoolean(body.isActive);
    const activeFlag = isActiveB === null ? true : isActiveB;

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
          EffectiveFrom: effectiveFrom,
          EffectiveTo: effectiveTo,
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
        EffectiveFrom: true,
        EffectiveTo: true,
      },
    });
    if (!existing)
      throw new NotFoundException('Transaction fee rule not found');

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
      data.IsActive = b;
    }

    let mergedEffectiveFrom = existing.EffectiveFrom;
    if (body.effectiveFrom !== undefined) {
      const d = parseOptionalDateTime(body.effectiveFrom);
      if (!d) throw new BadRequestException('effectiveFrom is invalid');
      data.EffectiveFrom = d;
      mergedEffectiveFrom = d;
    }

    let mergedEffectiveTo: Date | null = existing.EffectiveTo;
    if (body.effectiveTo !== undefined) {
      const raw = body.effectiveTo;
      if (raw === null || raw === '') {
        data.EffectiveTo = null;
        mergedEffectiveTo = null;
      } else {
        const d = parseOptionalDateTime(raw);
        if (!d) throw new BadRequestException('effectiveTo is invalid');
        data.EffectiveTo = d;
        mergedEffectiveTo = d;
      }
    }

    if (
      mergedEffectiveTo &&
      mergedEffectiveTo.getTime() < mergedEffectiveFrom.getTime()
    ) {
      throw new BadRequestException(
        'effectiveTo must be on or after effectiveFrom',
      );
    }

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
    isActive?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  }) {
    const page = Math.max(1, parseInt(input.page || '1', 10) || 1);
    const pageSizeRaw = parseInt(input.pageSize || '12', 10) || 12;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
    const search = asTrimmedString(input.search);
    const paymentChannel = parseChannelFilterToken(input.paymentChannel);
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
      isActive,
      effectiveFrom,
      effectiveTo,
    };
  }
}
