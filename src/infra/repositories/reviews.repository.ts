import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface EnterpriseReviewsCriteria {
  enterpriseId: string;
  q?: string;
  rating?: number;
  status?: 'all' | 'active' | 'hidden';
  startDate?: string;
  endDate?: string;
  sort?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface AdminReviewsCriteria {
  q?: string;
  enterpriseId?: string;
  status?: 'all' | 'active' | 'hidden';
  startDate?: string;
  endDate?: string;
}

/**
 * Reviews repository: create review, update visibility, list for enterprise/admin, stats.
 */
@Injectable()
export class ReviewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getCustomerIdByAccountId(accountId: string): Promise<string | null> {
    const c = await this.prisma.customer.findFirst({
      where: { AccountID: accountId },
      select: { CustomerID: true },
    });
    return c?.CustomerID ?? null;
  }

  async getEnterpriseIdByAccountId(accountId: string): Promise<string | null> {
    const e = await this.prisma.enterprise.findUnique({
      where: { AccountID: accountId },
      select: { EnterpriseID: true },
    });
    return e?.EnterpriseID ?? null;
  }

  async create(data: {
    CustomerID: string;
    EnterpriseID: string;
    Rating: number | null;
    Comment: string | null;
    Images?: string[];
  }) {
    return this.prisma.review.create({
      data: {
        CustomerID: data.CustomerID,
        EnterpriseID: data.EnterpriseID,
        Rating: data.Rating,
        Comment: data.Comment,
        Images: data.Images?.length ? data.Images : undefined,
      },
      include: {
        customer: {
          select: { account: { select: { Username: true } } },
        },
      },
    });
  }

  async updateIsHidden(reviewId: string, isHidden: boolean) {
    return this.prisma.review.update({
      where: { ReviewID: reviewId },
      data: { IsHidden: isHidden, UpdatedAt: new Date() },
    });
  }

  buildWhereForEnterprise(
    enterpriseId: string,
    criteria: Omit<EnterpriseReviewsCriteria, 'enterpriseId' | 'page' | 'limit'>,
  ): Prisma.ReviewWhereInput {
    const where: Prisma.ReviewWhereInput = { EnterpriseID: enterpriseId };

    if (criteria.status === 'active') where.IsHidden = false;
    else if (criteria.status === 'hidden') where.IsHidden = true;

    if (criteria.q) {
      where.OR = [
        { Comment: { contains: criteria.q } },
        { customer: { account: { Username: { contains: criteria.q } } } },
      ];
    }
    if (criteria.rating != null && criteria.rating >= 1 && criteria.rating <= 5) {
      where.Rating = criteria.rating;
    }
    if (criteria.startDate || criteria.endDate) {
      where.CreatedAt = {};
      if (criteria.startDate) {
        where.CreatedAt.gte = new Date(criteria.startDate);
      }
      if (criteria.endDate) {
        const end = new Date(criteria.endDate);
        end.setHours(23, 59, 59, 999);
        where.CreatedAt.lte = end;
      }
    }
    return where;
  }

  async findManyForEnterprise(
    where: Prisma.ReviewWhereInput,
    orderBy: Prisma.ReviewOrderByWithRelationInput,
    skip: number,
    take: number,
  ) {
    return this.prisma.review.findMany({
      where,
      include: {
        customer: {
          select: {
            account: {
              select: { Username: true, Email: true },
            },
          },
        },
      },
      orderBy,
      skip,
      take,
    });
  }

  async countForEnterprise(where: Prisma.ReviewWhereInput): Promise<number> {
    return this.prisma.review.count({ where });
  }

  async getAverageAndCount(enterpriseId: string, excludeHidden = true) {
    const where: Prisma.ReviewWhereInput = {
      EnterpriseID: enterpriseId,
      Rating: { not: null, gte: 1, lte: 5 },
    };
    if (excludeHidden) where.IsHidden = false;

    const [agg, groups] = await Promise.all([
      this.prisma.review.aggregate({
        where,
        _avg: { Rating: true },
        _count: { Rating: true },
      }),
      this.prisma.review.groupBy({
        by: ['Rating'],
        _count: { Rating: true },
        where: {
          EnterpriseID: enterpriseId,
          Rating: { not: null, gte: 1, lte: 5 },
        },
      }),
    ]);
    const ratingDistribution: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
    groups.forEach((g) => {
      if (g.Rating != null) ratingDistribution[String(g.Rating)] = g._count.Rating;
    });
    return {
      averageRating: agg._avg.Rating ?? 0,
      totalReviews: agg._count.Rating ?? 0,
      ratingDistribution,
    };
  }

  async getHiddenAndVisibleCount(enterpriseId: string): Promise<{ hidden: number; visible: number }> {
    const [hidden, visible] = await Promise.all([
      this.prisma.review.count({ where: { EnterpriseID: enterpriseId, IsHidden: true } }),
      this.prisma.review.count({ where: { EnterpriseID: enterpriseId, IsHidden: false } }),
    ]);
    return { hidden, visible };
  }

  buildWhereForAdmin(criteria: AdminReviewsCriteria): Prisma.ReviewWhereInput {
    const where: Prisma.ReviewWhereInput = {};

    if (criteria.status === 'active') where.IsHidden = false;
    else if (criteria.status === 'hidden') where.IsHidden = true;
    if (criteria.enterpriseId) where.EnterpriseID = criteria.enterpriseId;
    if (criteria.startDate || criteria.endDate) {
      where.CreatedAt = {};
      if (criteria.startDate) where.CreatedAt.gte = new Date(criteria.startDate);
      if (criteria.endDate) {
        const end = new Date(criteria.endDate);
        end.setHours(23, 59, 59, 999);
        where.CreatedAt.lte = end;
      }
    }
    if (criteria.q) {
      where.OR = [
        { Comment: { contains: criteria.q } },
        { customer: { account: { Username: { contains: criteria.q } } } },
        { enterprise: { EnterpriseName: { contains: criteria.q } } },
      ];
    }
    return where;
  }

  async findManyForAdmin(
    where: Prisma.ReviewWhereInput,
    take: number,
  ) {
    return this.prisma.review.findMany({
      where,
      include: {
        customer: {
          select: {
            account: { select: { Username: true, Email: true } },
          },
        },
        enterprise: {
          select: { EnterpriseID: true, EnterpriseName: true },
        },
      },
      orderBy: { CreatedAt: 'desc' },
      take,
    });
  }

  async findUnique(reviewId: string) {
    return this.prisma.review.findUnique({
      where: { ReviewID: reviewId },
      select: { ReviewID: true, EnterpriseID: true },
    });
  }
}
