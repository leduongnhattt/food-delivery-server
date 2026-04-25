import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

function mapGlobalRuleRow(row: {
  RuleID: string;
  RuleName: string | null;
  CommissionPercent: Prisma.Decimal;
  IsActive: boolean;
  ActivatedAt: Date | null;
  ExpiredAt?: Date | null;
  EffectiveFrom: Date;
  EffectiveTo: Date | null;
  CreatedAt: Date;
  UpdatedAt: Date | null;
  updatedBy: { account: { Username: string; Email: string } | null } | null;
}) {
  const updatedByAccount = row.updatedBy?.account;
  return {
    RuleID: row.RuleID,
    RuleName: row.RuleName,
    CommissionPercent: Number(row.CommissionPercent),
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

function parseCommissionPercent(value: unknown): number {
  return parsePercentRequired(value, {
    requiredMessage: 'commissionPercent is required',
    outOfRangeMessage: 'commissionPercent must be between 0 and 100',
  });
}

function mapCategoryRow(row: {
  CommissionDefaultID: string;
  FoodCategoryID: string;
  RuleName: string | null;
  CommissionPercent: Prisma.Decimal;
  IsActive: boolean;
  ActivatedAt: Date | null;
  ExpiredAt?: Date | null;
  EffectiveFrom: Date;
  EffectiveTo: Date | null;
  CreatedAt: Date;
  foodCategory: { CategoryName: string };
  updatedBy: {
    account: { Username: string; Email: string } | null;
  } | null;
}) {
  const updatedByAccount = row.updatedBy?.account;
  const updatedByLabel =
    updatedByAccount?.Email || updatedByAccount?.Username || null;
  return {
    CommissionDefaultID: row.CommissionDefaultID,
    FoodCategoryID: row.FoodCategoryID,
    CategoryName: row.foodCategory.CategoryName,
    RuleName: row.RuleName,
    CommissionPercent: Number(row.CommissionPercent),
    IsActive: row.IsActive,
    ActivatedAt: row.ActivatedAt ? row.ActivatedAt.toISOString() : null,
    ExpiredAt: row.ExpiredAt ? row.ExpiredAt.toISOString() : null,
    EffectiveFrom: toDateOnlyString(row.EffectiveFrom),
    EffectiveTo: row.EffectiveTo ? toDateOnlyString(row.EffectiveTo) : null,
    CreatedAt: row.CreatedAt.toISOString().slice(0, 10),
    UpdatedByLabel: updatedByLabel,
  };
}

/** Sentinel `FoodCategoryID` for global rows merged into category-rules list (not a real category). */
const GLOBAL_RULE_LIST_FOOD_CATEGORY_ID = '__GLOBAL__';

function mapGlobalRuleToCategoryListRow(row: {
  RuleID: string;
  RuleName: string | null;
  CommissionPercent: Prisma.Decimal;
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
  const updatedByLabel =
    updatedByAccount?.Email || updatedByAccount?.Username || null;
  return {
    CommissionDefaultID: row.RuleID,
    FoodCategoryID: GLOBAL_RULE_LIST_FOOD_CATEGORY_ID,
    CategoryName: 'Global (platform)',
    RuleName: row.RuleName,
    CommissionPercent: Number(row.CommissionPercent),
    IsActive: row.IsActive,
    ActivatedAt: row.ActivatedAt ? row.ActivatedAt.toISOString() : null,
    ExpiredAt: row.ExpiredAt ? row.ExpiredAt.toISOString() : null,
    EffectiveFrom: toDateOnlyString(row.EffectiveFrom),
    EffectiveTo: row.EffectiveTo ? toDateOnlyString(row.EffectiveTo) : null,
    CreatedAt: row.CreatedAt.toISOString().slice(0, 10),
    UpdatedByLabel: updatedByLabel,
    IsGlobal: true as const,
  };
}

/** Sort by effective window (newest first), then created date — used within global-only or category-only blocks. */
function compareCategoryListRows(
  a: ReturnType<typeof mapCategoryRow> & { IsGlobal?: boolean },
  b: ReturnType<typeof mapCategoryRow> & { IsGlobal?: boolean },
): number {
  const ef = b.EffectiveFrom.localeCompare(a.EffectiveFrom);
  if (ef !== 0) return ef;
  return b.CreatedAt.localeCompare(a.CreatedAt);
}

@Injectable()
export class AdminCommissionFeesService {
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
        ExpiredAt: true,
        EffectiveFrom: true,
        EffectiveTo: true,
        CreatedAt: true,
        UpdatedAt: true,
        updatedBy: {
          select: { account: { select: { Username: true, Email: true } } },
        },
      },
    });
    if (!row) return null;
    const mapped = mapGlobalRuleRow(row);
    return {
      DefaultID: mapped.RuleID,
      RuleName: mapped.RuleName,
      CommissionPercent: mapped.CommissionPercent,
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
    const rows = await this.prisma.platformCommissionGlobalRule.findMany({
      where: { DeletedAt: null },
      orderBy: [{ IsActive: 'desc' }, { EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
      select: {
        RuleID: true,
        RuleName: true,
        CommissionPercent: true,
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
      },
    });
    return { items: rows.map((row) => mapGlobalRuleRow(row)) };
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
      select: { RuleID: true, DeletedAt: true, EffectiveFrom: true, EffectiveTo: true, ActivatedAt: true, ExpiredAt: true },
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
    // If end date is extended to the future, clear ExpiredAt immediately.
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
        select: { RuleID: true, DeletedAt: true, ExpiredAt: true, EffectiveTo: true },
      });
      if (!row || row.DeletedAt) throw new NotFoundException('Global rule not found');
      if (row.ExpiredAt) throw new BadRequestException('Rule is expired');
      if (row.EffectiveTo && row.EffectiveTo.getTime() < Date.now()) {
        throw new BadRequestException('Rule is expired');
      }

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
      const and: Prisma.CategoryCommissionDefaultWhereInput[] = [];
      if (filterFrom) {
        and.push({ EffectiveFrom: { gte: filterFrom } });
      }
      if (filterTo) {
        and.push({ EffectiveFrom: { lte: filterTo } });
      }
      where.AND = and;
    }

    const searchQuery = params.search?.trim();
    if (searchQuery) {
      where.OR = [
        { RuleName: { contains: searchQuery } },
        { foodCategory: { CategoryName: { contains: searchQuery } } },
      ];
    }

    const globalSelect = {
      RuleID: true,
      RuleName: true,
      CommissionPercent: true,
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
    } as const;

    const categorySelect = {
      CommissionDefaultID: true,
      FoodCategoryID: true,
      RuleName: true,
      CommissionPercent: true,
      IsActive: true,
      ActivatedAt: true,
      ExpiredAt: true,
      EffectiveFrom: true,
      EffectiveTo: true,
      CreatedAt: true,
      foodCategory: { select: { CategoryName: true } },
      updatedBy: {
        select: {
          account: { select: { Username: true, Email: true } },
        },
      },
    } as const;

    const foodCategoryId = params.foodCategoryId?.trim();
    const includeGlobalRows = !foodCategoryId;

    const globalWhere: Prisma.PlatformCommissionGlobalRuleWhereInput = {
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
        const andG: Prisma.PlatformCommissionGlobalRuleWhereInput[] = [];
        if (filterFrom) {
          andG.push({ EffectiveFrom: { gte: filterFrom } });
        }
        if (filterTo) {
          andG.push({ EffectiveFrom: { lte: filterTo } });
        }
        globalWhere.AND = andG;
      }
      if (searchQuery) {
        globalWhere.RuleName = { contains: searchQuery };
      }
    }

    const [globalRows, categoryRows] = await Promise.all([
      includeGlobalRows
        ? this.prisma.platformCommissionGlobalRule.findMany({
          where: globalWhere,
          orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
          select: globalSelect,
        })
        : Promise.resolve([]),
      this.prisma.categoryCommissionDefault.findMany({
        where,
        orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
        select: categorySelect,
      }),
    ]);

    const globalItems = globalRows.map((row) => mapGlobalRuleToCategoryListRow(row));
    const categoryItems = categoryRows.map((row) => mapCategoryRow(row));
    // Global rows always precede category rows in the list (and pagination).
    const merged = [
      ...globalItems.sort(compareCategoryListRows),
      ...categoryItems.sort(compareCategoryListRows),
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
        ExpiredAt: true,
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
        ExpiredAt: true,
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
        IsActive: true,
        EffectiveFrom: true,
        EffectiveTo: true,
        ActivatedAt: true,
        ExpiredAt: true,
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
      const nextIsActive = asBoolean(body.isActive);
      if (nextIsActive === null) {
        throw new BadRequestException('isActive must be a boolean');
      }
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

    let mergedEffectiveFrom = existing.EffectiveFrom;
    if (body.effectiveFrom !== undefined) {
      const nextEffectiveFrom = parseDateOnlyRequired(body.effectiveFrom, 'effectiveFrom');
      data.EffectiveFrom = nextEffectiveFrom;
      mergedEffectiveFrom = nextEffectiveFrom;
    }
    // If admin moves EffectiveFrom to the future, treat it as Pending again,
    // unless they explicitly requested activation via `isActive=true`.
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
    // If end date is extended to the future, clear ExpiredAt immediately.
    if (mergedEffectiveTo.getTime() >= Date.now()) {
      data.ExpiredAt = null;
      // If this rule was previously activated (not Pending) and is currently within the effective window,
      // reactivate it automatically when it becomes un-expired.
      const isActiveExplicitlySet = body.isActive !== undefined;
      if (
        !isActiveExplicitlySet &&
        existing.ActivatedAt &&
        mergedEffectiveFrom.getTime() <= Date.now() &&
        mergedEffectiveFrom.getTime() <= mergedEffectiveTo.getTime()
      ) {
        data.IsActive = true;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (data.IsActive === true) {
        await tx.categoryCommissionDefault.updateMany({
          where: {
            DeletedAt: null,
            ExpiredAt: null,
            FoodCategoryID: mergedFoodCategoryId,
            IsActive: true,
            NOT: { CommissionDefaultID: rid },
          },
          data: { IsActive: false },
        });
      }

      return tx.categoryCommissionDefault.update({
        where: { CommissionDefaultID: rid },
        data,
        select: {
          CommissionDefaultID: true,
          FoodCategoryID: true,
          RuleName: true,
          CommissionPercent: true,
          IsActive: true,
          ActivatedAt: true,
          ExpiredAt: true,
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
    });

    return { success: true as const, item: mapCategoryRow(updated) };
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
