import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

const DEFAULT_PAGE_SIZE = 10;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;
const DEFAULT_REVIEWS_PAGE_SIZE = 50;

export const RestaurantsRepositoryLimits = {
  defaultPageSize: DEFAULT_PAGE_SIZE,
  minPageSize: MIN_PAGE_SIZE,
  maxPageSize: MAX_PAGE_SIZE,
  defaultReviewsLimit: DEFAULT_REVIEWS_PAGE_SIZE,
} as const;

export interface RestaurantListCriteria {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  isOpen?: boolean;
  minRating?: number;
}

/**
 * Restaurants (Enterprise) repository: data access for listing, detail, CRUD, reviews, commission.
 */
@Injectable()
export class RestaurantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  buildWhereFromCriteria(
    criteria: RestaurantListCriteria,
  ): Prisma.EnterpriseWhereInput {
    const where: Prisma.EnterpriseWhereInput = {
      IsActive: criteria.isOpen !== undefined ? criteria.isOpen : true,
    };
    if (criteria.search) {
      where.OR = [
        { EnterpriseName: { contains: criteria.search } },
        { Description: { contains: criteria.search } },
      ];
    }
    if (criteria.category) {
      where.foods = {
        some: {
          foodCategory: { CategoryName: criteria.category },
          IsAvailable: true,
        },
      };
    }
    if (criteria.minRating != null) {
      where.reviews = {
        some: { Rating: { gte: criteria.minRating } },
      };
    }
    return where;
  }

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

  async findManyWithCount(
    where: Prisma.EnterpriseWhereInput,
    orderBy: Prisma.EnterpriseOrderByWithRelationInput,
    skip: number,
    take: number,
  ) {
    const [rows, total] = await Promise.all([
      this.prisma.enterprise.findMany({
        where,
        include: {
          account: { select: { Avatar: true } },
          foods: {
            where: { IsAvailable: true },
            select: {
              FoodID: true,
              DishName: true,
              Price: true,
              ImageURL: true,
              foodCategory: { select: { CategoryName: true } },
            },
            take: 5,
          },
          reviews: { select: { Rating: true } },
          _count: {
            select: {
              foods: { where: { IsAvailable: true } },
              reviews: true,
            },
          },
        },
        orderBy,
        skip,
        take,
      }),
      this.prisma.enterprise.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(enterpriseId: string) {
    return this.prisma.enterprise.findUnique({
      where: { EnterpriseID: enterpriseId },
      include: {
        account: { select: { Avatar: true } },
        foods: {
          where: { IsAvailable: true },
          include: {
            foodCategory: {
              select: { CategoryID: true, CategoryName: true },
            },
          },
          orderBy: { CreatedAt: 'desc' },
        },
        reviews: {
          select: {
            Rating: true,
            Comment: true,
            CreatedAt: true,
            customer: { select: { FullName: true } },
          },
          orderBy: { CreatedAt: 'desc' },
        },
        _count: {
          select: {
            foods: { where: { IsAvailable: true } },
            reviews: true,
          },
        },
      },
    });
  }

  async create(data: {
    EnterpriseName: string;
    Description: string;
    Address: string;
    PhoneNumber: string;
    OpenHours: string;
    CloseHours: string;
    IsActive: boolean;
    AccountID: string;
  }) {
    return this.prisma.enterprise.create({ data });
  }

  async update(
    enterpriseId: string,
    data: Prisma.EnterpriseUpdateInput,
  ) {
    return this.prisma.enterprise.update({
      where: { EnterpriseID: enterpriseId },
      data,
    });
  }

  async delete(enterpriseId: string) {
    return this.prisma.enterprise.delete({
      where: { EnterpriseID: enterpriseId },
    });
  }

  async getCommissionRate(enterpriseId: string): Promise<number | null> {
    const e = await this.prisma.enterprise.findUnique({
      where: { EnterpriseID: enterpriseId },
      select: { CommissionRate: true },
    });
    return e?.CommissionRate != null ? Number(e.CommissionRate) : null;
  }

  async findReviewsByEnterprise(
    enterpriseId: string,
    sort: 'newest' | 'oldest',
    skip: number,
    take: number,
  ) {
    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { EnterpriseID: enterpriseId },
        include: {
          customer: {
            select: {
              account: { select: { Username: true } },
            },
          },
        },
        orderBy: { CreatedAt: sort === 'newest' ? 'desc' : 'asc' },
        skip,
        take,
      }),
      this.prisma.review.count({
        where: { EnterpriseID: enterpriseId },
      }),
    ]);
    return { reviews, total };
  }

  async getAverageRating(enterpriseId: string): Promise<number> {
    const rows = await this.prisma.review.findMany({
      where: {
        EnterpriseID: enterpriseId,
        Rating: { not: null, gte: 1, lte: 5 },
      },
      select: { Rating: true },
    });
    const ratings = rows
      .map((r) => r.Rating)
      .filter((r): r is number => r != null && r >= 1 && r <= 5);
    if (ratings.length === 0) return 0;
    return ratings.reduce((a, b) => a + b, 0) / ratings.length;
  }

  async ensureEnterpriseExists(enterpriseId: string): Promise<boolean> {
    const e = await this.prisma.enterprise.findUnique({
      where: { EnterpriseID: enterpriseId },
      select: { EnterpriseID: true },
    });
    return !!e;
  }
}
