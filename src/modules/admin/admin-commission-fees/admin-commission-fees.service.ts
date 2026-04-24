import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { asBoolean, asTrimmedString } from '@common/utils/parse.utils';

function mapGlobalRuleRow(r: {
  RuleID: string;
  RuleName: string | null;
  CommissionPercent: Prisma.Decimal;
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
    CommissionPercent: Number(r.CommissionPercent),
    IsActive: r.IsActive,
    ActivatedAt: r.ActivatedAt ? r.ActivatedAt.toISOString() : null,
    EffectiveFrom: toDateOnlyString(r.EffectiveFrom),
    EffectiveTo: r.EffectiveTo ? toDateOnlyString(r.EffectiveTo) : null,
    CreatedAt: r.CreatedAt.toISOString(),
    UpdatedAt: r.UpdatedAt?.toISOString() ?? null,
    UpdatedByLabel: u?.Email || u?.Username || null,
  };
}

function parseCommissionPercent(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0 || value > 100) {
      throw new BadRequestException(
        'commissionPercent must be between 0 and 100',
      );
    }
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new BadRequestException(
        'commissionPercent must be between 0 and 100',
      );
    }
    return Math.round(n * 100) / 100;
  }
  throw new BadRequestException('commissionPercent is required');
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

function parseDateOnlyRequired(value: unknown, field: string): Date {
  const s = asTrimmedString(value);
  if (!s) throw new BadRequestException(`${field} is required`);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid ${field}`);
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

function mapCategoryRow(r: {
  CommissionDefaultID: string;
  FoodCategoryID: string;
  RuleName: string | null;
  CommissionPercent: Prisma.Decimal;
  IsActive: boolean;
  ActivatedAt: Date | null;
  EffectiveFrom: Date;
  EffectiveTo: Date | null;
  CreatedAt: Date;
  foodCategory: { CategoryName: string };
  updatedBy: {
    account: { Username: string; Email: string } | null;
  } | null;
}) {
  const u = r.updatedBy?.account;
  const updatedByLabel = u?.Email || u?.Username || null;
  return {
    CommissionDefaultID: r.CommissionDefaultID,
    FoodCategoryID: r.FoodCategoryID,
    CategoryName: r.foodCategory.CategoryName,
    RuleName: r.RuleName,
    CommissionPercent: Number(r.CommissionPercent),
    IsActive: r.IsActive,
    ActivatedAt: r.ActivatedAt ? r.ActivatedAt.toISOString() : null,
    EffectiveFrom: toDateOnlyString(r.EffectiveFrom),
    EffectiveTo: r.EffectiveTo ? toDateOnlyString(r.EffectiveTo) : null,
    CreatedAt: r.CreatedAt.toISOString().slice(0, 10),
    UpdatedByLabel: updatedByLabel,
  };
}

@Injectable()
export class AdminCommissionFeesService {
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
    const row = await this.prisma.platformCommissionGlobalRule.findFirst({
      where: { DeletedAt: null, IsActive: true },
      orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
      select: {
        RuleID: true,
        RuleName: true,
        CommissionPercent: true,
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
    const rows = await this.prisma.platformCommissionGlobalRule.findMany({
      where: { DeletedAt: null },
      orderBy: [{ IsActive: 'desc' }, { EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
      select: {
        RuleID: true,
        RuleName: true,
        CommissionPercent: true,
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
      commissionPercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
    opts?: { forceActivate?: boolean },
  ) {
    const adminId = await this.requireAdminId(accountId);
    const pct = parseCommissionPercent(body.commissionPercent);
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
    if (!effectiveTo) {
      effectiveTo = addDaysUtc(effectiveFrom, 1);
    }
    if (effectiveTo.getTime() < effectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      return tx.platformCommissionGlobalRule.create({
        data: {
          RuleName: ruleName,
          CommissionPercent: new Prisma.Decimal(pct),
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
          CommissionPercent: true,
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
      commissionPercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    const adminId = await this.requireAdminId(accountId);
    const id = asTrimmedString(ruleId);
    if (!id) throw new BadRequestException('ruleId is required');

    const existing = await this.prisma.platformCommissionGlobalRule.findUnique({
      where: { RuleID: id },
      select: { RuleID: true, DeletedAt: true, EffectiveFrom: true, EffectiveTo: true, ActivatedAt: true },
    });
    if (!existing || existing.DeletedAt) throw new NotFoundException('Global rule not found');

    const data: Prisma.PlatformCommissionGlobalRuleUpdateInput = {
      updatedBy: { connect: { AdminID: adminId } },
      DeletedAt: null,
    };
    if (body.ruleName !== undefined) data.RuleName = asTrimmedString(body.ruleName);
    if (body.commissionPercent !== undefined) {
      data.CommissionPercent = new Prisma.Decimal(parseCommissionPercent(body.commissionPercent));
    }
    if (body.effectiveFrom !== undefined) {
      data.EffectiveFrom = parseDateOnlyRequired(body.effectiveFrom, 'effectiveFrom');
    }
    if (body.effectiveTo !== undefined) {
      const raw = body.effectiveTo;
      data.EffectiveTo =
        raw === null || raw === '' ? null : parseDateOnlyRequired(raw, 'effectiveTo');
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

    // Activation is handled via explicit activate endpoint to guarantee one-active invariant.
    const updated = await this.prisma.platformCommissionGlobalRule.update({
      where: { RuleID: id },
      data,
      select: {
        RuleID: true,
        RuleName: true,
        CommissionPercent: true,
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
      const row = await tx.platformCommissionGlobalRule.findUnique({
        where: { RuleID: id },
        select: { RuleID: true, DeletedAt: true },
      });
      if (!row || row.DeletedAt) throw new NotFoundException('Global rule not found');

      await tx.platformCommissionGlobalRule.updateMany({
        where: { DeletedAt: null, IsActive: true },
        data: { IsActive: false },
      });
      return tx.platformCommissionGlobalRule.update({
        where: { RuleID: id },
        data: {
          IsActive: true,
          ActivatedAt: new Date(),
          updatedBy: { connect: { AdminID: adminId } },
        },
        select: {
          RuleID: true,
          RuleName: true,
          CommissionPercent: true,
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

  async listCategoryRules(params: {
    page: number;
    pageSize: number;
    search?: string | null;
    foodCategoryId?: string | null;
    status?: string | null;
    isActive?: boolean | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.CategoryCommissionDefaultWhereInput = { DeletedAt: null };

    if (params.foodCategoryId) {
      where.FoodCategoryID = params.foodCategoryId;
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
      const and: Prisma.CategoryCommissionDefaultWhereInput[] = [];
      if (filterFrom) {
        and.push({ EffectiveFrom: { gte: filterFrom } });
      }
      if (filterTo) {
        and.push({ EffectiveFrom: { lte: filterTo } });
      }
      where.AND = and;
    }

    const q = params.search?.trim();
    if (q) {
      where.OR = [
        { RuleName: { contains: q } },
        { foodCategory: { CategoryName: { contains: q } } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.categoryCommissionDefault.count({ where }),
      this.prisma.categoryCommissionDefault.findMany({
        where,
        orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
        skip,
        take: pageSize,
        select: {
          CommissionDefaultID: true,
          FoodCategoryID: true,
          RuleName: true,
          CommissionPercent: true,
          IsActive: true,
          ActivatedAt: true,
          EffectiveFrom: true,
          EffectiveTo: true,
          CreatedAt: true,
          foodCategory: { select: { CategoryName: true } },
          updatedBy: {
            select: {
              account: { select: { Username: true, Email: true } },
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((r) => mapCategoryRow(r)),
      total,
      page,
      pageSize,
    };
  }

  async getCategoryRule(id: string) {
    const rid = asTrimmedString(id);
    if (!rid) throw new BadRequestException('id is required');

    const row = await this.prisma.categoryCommissionDefault.findUnique({
      where: { CommissionDefaultID: rid },
      select: {
        CommissionDefaultID: true,
        FoodCategoryID: true,
        RuleName: true,
        CommissionPercent: true,
        IsActive: true,
        ActivatedAt: true,
        EffectiveFrom: true,
        EffectiveTo: true,
        CreatedAt: true,
        DeletedAt: true,
        foodCategory: { select: { CategoryName: true } },
        updatedBy: {
          select: {
            account: { select: { Username: true, Email: true } },
          },
        },
      },
    });
    if (!row || row.DeletedAt) throw new NotFoundException('Commission rule not found');
    return mapCategoryRow(row);
  }

  async createCategoryRule(
    accountId: string,
    body: {
      foodCategoryId?: unknown;
      ruleName?: unknown;
      commissionPercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    const adminId = await this.requireAdminId(accountId);
    const foodCategoryId = asTrimmedString(body.foodCategoryId);
    if (!foodCategoryId) {
      throw new BadRequestException('foodCategoryId is required');
    }

    const cat = await this.prisma.foodCategory.findUnique({
      where: { CategoryID: foodCategoryId },
      select: { CategoryID: true },
    });
    if (!cat) throw new BadRequestException('Food category not found');

    const effectiveFrom = parseDateOnlyRequired(body.effectiveFrom, 'effectiveFrom');
    const minFrom = todayDateOnlyUtc();
    if (effectiveFrom.getTime() < minFrom.getTime()) {
      throw new BadRequestException('effectiveFrom cannot be in the past');
    }
    let effectiveTo =
      body.effectiveTo === undefined || body.effectiveTo === null || body.effectiveTo === ''
        ? null
        : parseDateOnlyRequired(body.effectiveTo, 'effectiveTo');
    if (!effectiveTo) {
      effectiveTo = addDaysUtc(effectiveFrom, 1);
    }
    if (effectiveTo.getTime() < effectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }

    const pct = parseCommissionPercent(body.commissionPercent);
    const ruleName = asTrimmedString(body.ruleName);
    // Always create as Pending; activation is manual or via cronjob.
    const activeFlag = false;

    try {
      const created = await this.prisma.categoryCommissionDefault.create({
        data: {
          foodCategory: { connect: { CategoryID: foodCategoryId } },
          updatedBy: { connect: { AdminID: adminId } },
          RuleName: ruleName,
          CommissionPercent: new Prisma.Decimal(pct),
          IsActive: activeFlag,
          ActivatedAt: null,
          EffectiveFrom: effectiveFrom,
          EffectiveTo: effectiveTo,
          DeletedAt: null,
        },
        select: {
          CommissionDefaultID: true,
          FoodCategoryID: true,
          RuleName: true,
          CommissionPercent: true,
          IsActive: true,
          ActivatedAt: true,
          EffectiveFrom: true,
          EffectiveTo: true,
          CreatedAt: true,
          foodCategory: { select: { CategoryName: true } },
          updatedBy: {
            select: {
              account: { select: { Username: true, Email: true } },
            },
          },
        },
      });
      return { success: true as const, item: mapCategoryRow(created) };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'A rule with this category and effective start already exists',
        );
      }
      throw e;
    }
  }

  async updateCategoryRule(
    accountId: string,
    id: string,
    body: {
      foodCategoryId?: unknown;
      ruleName?: unknown;
      commissionPercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    const adminId = await this.requireAdminId(accountId);
    const rid = asTrimmedString(id);
    if (!rid) throw new BadRequestException('id is required');

    const existing = await this.prisma.categoryCommissionDefault.findUnique({
      where: { CommissionDefaultID: rid },
      select: {
        CommissionDefaultID: true,
        FoodCategoryID: true,
        EffectiveFrom: true,
        EffectiveTo: true,
        ActivatedAt: true,
        DeletedAt: true,
      },
    });
    if (!existing || existing.DeletedAt) throw new NotFoundException('Commission rule not found');

    const data: Prisma.CategoryCommissionDefaultUpdateInput = {
      updatedBy: { connect: { AdminID: adminId } },
    };

    let mergedFoodCategoryId = existing.FoodCategoryID;
    const nextFoodCategoryId = asTrimmedString(body.foodCategoryId);
    if (nextFoodCategoryId) {
      const cat = await this.prisma.foodCategory.findUnique({
        where: { CategoryID: nextFoodCategoryId },
        select: { CategoryID: true },
      });
      if (!cat) throw new BadRequestException('Food category not found');
      data.foodCategory = { connect: { CategoryID: nextFoodCategoryId } };
      mergedFoodCategoryId = nextFoodCategoryId;
    }

    if (body.ruleName !== undefined) {
      data.RuleName = asTrimmedString(body.ruleName);
    }

    if (body.commissionPercent !== undefined) {
      data.CommissionPercent = new Prisma.Decimal(
        parseCommissionPercent(body.commissionPercent),
      );
    }

    if (body.isActive !== undefined) {
      const b = asBoolean(body.isActive);
      if (b === null) {
        throw new BadRequestException('isActive must be a boolean');
      }
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
    if (!mergedEffectiveTo) {
      mergedEffectiveTo = addDaysUtc(mergedEffectiveFrom, 1);
    }
    if (mergedEffectiveTo.getTime() < mergedEffectiveFrom.getTime()) {
      throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    }
    data.EffectiveTo = mergedEffectiveTo;

    const dup = await this.prisma.categoryCommissionDefault.findFirst({
      where: {
        FoodCategoryID: mergedFoodCategoryId,
        EffectiveFrom: mergedEffectiveFrom,
        DeletedAt: null,
        NOT: { CommissionDefaultID: rid },
      },
      select: { CommissionDefaultID: true },
    });
    if (dup) {
      throw new ConflictException(
        'A rule with this category and effective start already exists',
      );
    }

    try {
      const updated = await this.prisma.categoryCommissionDefault.update({
        where: { CommissionDefaultID: rid },
        data,
        select: {
          CommissionDefaultID: true,
          FoodCategoryID: true,
          RuleName: true,
          CommissionPercent: true,
          IsActive: true,
          ActivatedAt: true,
          EffectiveFrom: true,
          EffectiveTo: true,
          CreatedAt: true,
          foodCategory: { select: { CategoryName: true } },
          updatedBy: {
            select: {
              account: { select: { Username: true, Email: true } },
            },
          },
        },
      });
      return { success: true as const, item: mapCategoryRow(updated) };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'A rule with this category and effective start already exists',
        );
      }
      throw e;
    }
  }

  parseListQuery(input: {
    page?: string;
    pageSize?: string;
    search?: string;
    foodCategoryId?: string;
    status?: string;
    isActive?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  }) {
    const page = Math.max(1, parseInt(input.page || '1', 10) || 1);
    const pageSizeRaw = parseInt(input.pageSize || '12', 10) || 12;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
    const search = asTrimmedString(input.search);
    const foodCategoryId = asTrimmedString(input.foodCategoryId);
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
      foodCategoryId,
      status,
      isActive,
      effectiveFrom,
      effectiveTo,
    };
  }
}
