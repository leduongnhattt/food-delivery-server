import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

/** Default and bounds for pagination. */
const DEFAULT_PAGE_SIZE = 10;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SEARCH_LIMIT = 20;

export const FoodsRepositoryLimits = {
  defaultPageSize: DEFAULT_PAGE_SIZE,
  minPageSize: MIN_PAGE_SIZE,
  maxPageSize: MAX_PAGE_SIZE,
  defaultSearchLimit: DEFAULT_SEARCH_LIMIT,
} as const;

/** Criteria for listing foods (aligned with API query params). */
export interface FoodListCriteria {
  limit?: number;
  page?: number;
  restaurantId?: string;
  category?: string;
  search?: string;
  isAvailable?: boolean;
  minPrice?: number;
  maxPrice?: number;
}

/**
 * Foods repository: centralizes Food (and related) data access.
 * Centralized under infra/repositories for project-wide use.
 */
@Injectable()
export class FoodsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds Prisma where clause from API criteria.
   */
  buildWhereFromCriteria(criteria: FoodListCriteria): Prisma.FoodWhereInput {
    const where: Prisma.FoodWhereInput = {
      IsAvailable:
        criteria.isAvailable !== undefined ? criteria.isAvailable : true,
    };
    if (criteria.restaurantId) {
      where.EnterpriseID = criteria.restaurantId;
    }
    if (criteria.category) {
      where.foodCategory = { CategoryName: criteria.category };
    }
    if (criteria.search) {
      where.OR = [
        { DishName: { contains: criteria.search } },
        { Description: { contains: criteria.search } },
      ];
    }
    if (
      criteria.minPrice != null ||
      criteria.maxPrice != null
    ) {
      where.Price = {};
      if (criteria.minPrice != null) {
        where.Price.gte = criteria.minPrice;
      }
      if (criteria.maxPrice != null) {
        where.Price.lte = criteria.maxPrice;
      }
    }
    return where;
  }

  /**
   * Normalizes pagination params (page, limit) within allowed bounds.
   */
  normalizePagination(
    page?: number,
    limit?: number,
  ): { page: number; limit: number; skip: number } {
    const safeLimit = Math.min(
      Math.max(limit ?? DEFAULT_PAGE_SIZE, MIN_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );
    const safePage = Math.max(page ?? 1, 1);
    const skip = (safePage - 1) * safeLimit;
    return { page: safePage, limit: safeLimit, skip };
  }

  /**
   * Finds foods with category and enterprise, ordered by stock and created date.
   */
  async findManyWithCategoryAndEnterprise(
    where: Prisma.FoodWhereInput,
    orderBy: Prisma.FoodOrderByWithRelationInput[],
    skip: number,
    take: number,
  ) {
    return this.prisma.food.findMany({
      where,
      include: {
        foodCategory: {
          select: {
            CategoryID: true,
            CategoryName: true,
          },
        },
        enterprise: {
          select: {
            EnterpriseID: true,
            EnterpriseName: true,
            Address: true,
            PhoneNumber: true,
            OpenHours: true,
            CloseHours: true,
            IsActive: true,
          },
        },
      },
      orderBy,
      skip,
      take,
    });
  }

  /**
   * Counts foods matching the given where clause.
   */
  async count(where: Prisma.FoodWhereInput): Promise<number> {
    return this.prisma.food.count({ where });
  }

  /**
   * Search available foods by dish name or category name (for search box).
   */
  async searchAvailableByKeyword(
    keyword: string,
    take: number,
  ) {
    return this.prisma.food.findMany({
      where: {
        OR: [
          { DishName: { contains: keyword } },
          {
            foodCategory: {
              CategoryName: { contains: keyword },
            },
          },
        ],
        IsAvailable: true,
      },
      include: {
        enterprise: {
          select: {
            EnterpriseName: true,
            EnterpriseID: true,
          },
        },
        foodCategory: {
          select: {
            CategoryName: true,
          },
        },
      },
      take,
      orderBy: { DishName: 'asc' },
    });
  }

  /**
   * Finds foods by IDs with category and enterprise names (for by-ids endpoint).
   */
  async findByIdsWithCategoryAndEnterprise(ids: string[]) {
    if (!ids?.length) {
      return [];
    }
    return this.prisma.food.findMany({
      where: { FoodID: { in: ids } },
      select: {
        FoodID: true,
        DishName: true,
        Price: true,
        Description: true,
        ImageURL: true,
        EnterpriseID: true,
        foodCategory: { select: { CategoryName: true } },
        enterprise: { select: { EnterpriseName: true } },
      },
    });
  }

  /**
   * Fetch food details for admin/editor screens.
   * Includes category and menu links (menu -> enterprise).
   */
  async findByIdDetailed(foodId: string) {
    if (!foodId) return null;
    return this.prisma.food.findUnique({
      where: { FoodID: foodId },
      include: {
        foodCategory: true,
        menuFoods: {
          include: {
            menu: {
              include: {
                enterprise: true,
              },
            },
          },
        },
      },
    });
  }

  async findEnterpriseById(enterpriseId: string) {
    if (!enterpriseId) return null;
    return this.prisma.enterprise.findUnique({
      where: { EnterpriseID: enterpriseId },
      select: { EnterpriseID: true },
    });
  }

  async findFoodCategoryByName(categoryName: string) {
    if (!categoryName) return null;
    return this.prisma.foodCategory.findFirst({
      where: { CategoryName: categoryName },
      select: { CategoryID: true, CategoryName: true },
    });
  }

  async findFirstMenuForEnterprise(enterpriseId: string) {
    if (!enterpriseId) return null;
    return this.prisma.menu.findFirst({
      where: { EnterpriseID: enterpriseId },
      orderBy: { CreatedAt: 'asc' },
      select: { MenuID: true },
    });
  }

  async linkFoodToMenuIfNotLinked(foodId: string, menuId: string) {
    if (!foodId || !menuId) return;
    try {
      await this.prisma.menuFood.create({
        data: { FoodID: foodId, MenuID: menuId },
      });
    } catch {
      // best-effort link; ignore unique violations or any errors
    }
  }

  async createFood(data: {
    DishName: string;
    Description: string;
    Price: number;
    ImageURL?: string | null;
    FoodCategoryID: string;
    EnterpriseID: string;
    IsAvailable: boolean;
  }) {
    return this.prisma.food.create({
      data,
      include: {
        foodCategory: true,
        menuFoods: {
          include: {
            menu: {
              include: {
                enterprise: true,
              },
            },
          },
        },
      },
    });
  }

  async updateFood(
    foodId: string,
    data: {
      DishName?: string;
      Description?: string;
      Price?: number;
      ImageURL?: string | null;
      IsAvailable?: boolean;
    },
  ) {
    return this.prisma.food.update({
      where: { FoodID: foodId },
      data,
      include: {
        foodCategory: true,
        menuFoods: {
          include: {
            menu: {
              include: {
                enterprise: true,
              },
            },
          },
        },
      },
    });
  }

  async deleteFood(foodId: string) {
    return this.prisma.food.delete({ where: { FoodID: foodId } });
  }
}
