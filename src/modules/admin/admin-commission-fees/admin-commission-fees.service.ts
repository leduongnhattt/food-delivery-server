import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { asBoolean, asTrimmedString } from '@common/utils/parse.utils';

const PLATFORM_COMMISSION_DEFAULT_ID = '00000000-0000-0000-0000-000000000001';

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

function toDateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mapCategoryRow(r: {
  CommissionDefaultID: string;
  FoodCategoryID: string;
  RuleName: string | null;
  CommissionPercent: Prisma.Decimal;
  IsActive: boolean;
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

  async getGlobal() {
    let row = await this.prisma.platformCommissionDefault.findUnique({
      where: { DefaultID: PLATFORM_COMMISSION_DEFAULT_ID },
      include: {
        updatedBy: {
          select: {
            account: { select: { Username: true, Email: true } },
          },
        },
      },
    });
    if (!row) {
      row = await this.prisma.platformCommissionDefault.create({
        data: {
          DefaultID: PLATFORM_COMMISSION_DEFAULT_ID,
          CommissionPercent: new Prisma.Decimal(0),
          RuleName: null,
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
    const displayEffective =
      row.UpdatedAt?.toISOString().slice(0, 10) ??
      row.CreatedAt.toISOString().slice(0, 10);
    return {
      DefaultID: row.DefaultID,
      RuleName: row.RuleName,
      CommissionPercent: Number(row.CommissionPercent),
      UpdatedAt: row.UpdatedAt?.toISOString() ?? row.CreatedAt.toISOString(),
      /** Card "effective date" — platform row has no period fields; use last update time. */
      EffectiveDisplayDate: displayEffective,
      UpdatedByLabel: u?.Email || u?.Username || null,
    };
  }

  async updateGlobal(
    accountId: string,
    body: { ruleName?: unknown; commissionPercent?: unknown },
  ) {
    const adminId = await this.requireAdminId(accountId);
    const pct = parseCommissionPercent(body.commissionPercent);
    const ruleName = asTrimmedString(body.ruleName);

    const row = await this.prisma.platformCommissionDefault.upsert({
      where: { DefaultID: PLATFORM_COMMISSION_DEFAULT_ID },
      create: {
        DefaultID: PLATFORM_COMMISSION_DEFAULT_ID,
        CommissionPercent: new Prisma.Decimal(pct),
        RuleName: ruleName,
        updatedBy: { connect: { AdminID: adminId } },
      },
      update: {
        CommissionPercent: new Prisma.Decimal(pct),
        RuleName: ruleName,
        updatedBy: { connect: { AdminID: adminId } },
      },
    });

    return {
      success: true as const,
      DefaultID: row.DefaultID,
      CommissionPercent: Number(row.CommissionPercent),
    };
  }

  async listCategoryRules(params: {
    page: number;
    pageSize: number;
    search?: string | null;
    foodCategoryId?: string | null;
    isActive?: boolean | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.CategoryCommissionDefaultWhereInput = {};

    if (params.foodCategoryId) {
      where.FoodCategoryID = params.foodCategoryId;
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
    if (!row) throw new NotFoundException('Commission rule not found');
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

    const pct = parseCommissionPercent(body.commissionPercent);
    const ruleName = asTrimmedString(body.ruleName);
    const isActive = asBoolean(body.isActive);
    const activeFlag = isActive === null ? true : isActive;

    try {
      const created = await this.prisma.categoryCommissionDefault.create({
        data: {
          foodCategory: { connect: { CategoryID: foodCategoryId } },
          updatedBy: { connect: { AdminID: adminId } },
          RuleName: ruleName,
          CommissionPercent: new Prisma.Decimal(pct),
          IsActive: activeFlag,
          EffectiveFrom: effectiveFrom,
          EffectiveTo: effectiveTo,
        },
        select: {
          CommissionDefaultID: true,
          FoodCategoryID: true,
          RuleName: true,
          CommissionPercent: true,
          IsActive: true,
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
      },
    });
    if (!existing) throw new NotFoundException('Commission rule not found');

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

    const dup = await this.prisma.categoryCommissionDefault.findFirst({
      where: {
        FoodCategoryID: mergedFoodCategoryId,
        EffectiveFrom: mergedEffectiveFrom,
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
    isActive?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  }) {
    const page = Math.max(1, parseInt(input.page || '1', 10) || 1);
    const pageSizeRaw = parseInt(input.pageSize || '12', 10) || 12;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100);
    const search = asTrimmedString(input.search);
    const foodCategoryId = asTrimmedString(input.foodCategoryId);
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
      isActive,
      effectiveFrom,
      effectiveTo,
    };
  }
}
