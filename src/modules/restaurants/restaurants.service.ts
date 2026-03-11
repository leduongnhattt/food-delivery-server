import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RestaurantsRepository,
  RestaurantListCriteria,
  RestaurantsRepositoryLimits,
} from '@infra/repositories/restaurants.repository';

export interface RestaurantListItem {
  id: string;
  name: string;
  description: string;
  address: string;
  phone: string;
  avatarUrl: string;
  rating: number;
  deliveryTime: string;
  minimumOrder: number;
  isOpen: boolean;
  openHours?: string;
  closeHours?: string;
  createdAt: Date;
  updatedAt: Date;
  popularFoods: Array<{
    foodId: string;
    dishName: string;
    price: number;
    imageUrl: string;
    category: string;
  }>;
  totalFoods: number;
  totalReviews: number;
}

export interface RestaurantDetailDto extends RestaurantListItem {
  foods: Array<{
    foodId: string;
    dishName: string;
    price: number;
    stock: number;
    description: string;
    imageUrl: string;
    restaurantId: string;
    menu: { menuId: string; category: string };
  }>;
  reviews: Array<{
    id: string;
    rating: number;
    comment: string;
    customerName: string;
    createdAt: Date;
  }>;
}

export interface RestaurantsListResponse {
  restaurants: RestaurantListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface RestaurantReviewsResponse {
  reviews: Array<{
    id: string;
    author: string;
    rating: number;
    content: string;
    images: string[];
    createdAt: string;
    updatedAt: string | null;
  }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  averageRating: number;
  totalReviews: number;
}

const DEFAULT_DELIVERY_TIME = '30-45 min';
const DEFAULT_MINIMUM_ORDER = 0;

@Injectable()
export class RestaurantsService {
  constructor(private readonly repo: RestaurantsRepository) {}

  async findMany(criteria: RestaurantListCriteria): Promise<RestaurantsListResponse> {
    const where = this.repo.buildWhereFromCriteria(criteria);
    const { page, limit, skip } = this.repo.normalizePagination(
      criteria.page,
      criteria.limit,
    );

    const { rows, total } = await this.repo.findManyWithCount(
      where,
      { CreatedAt: 'desc' },
      skip,
      limit,
    );

    const restaurants: RestaurantListItem[] = rows.map((r) =>
      this.mapRowToListItem(r),
    );

    return {
      restaurants,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string): Promise<RestaurantDetailDto> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException('Restaurant not found');
    }

    const ratings = row.reviews
      .map((r) => r.Rating)
      .filter((r): r is number => r != null);
    const averageRating =
      ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;

    const foods = row.foods.map((f) => ({
      foodId: f.FoodID,
      dishName: f.DishName,
      price: Number(f.Price),
      stock: f.Stock,
      description: f.Description ?? '',
      imageUrl: f.ImageURL ?? '',
      restaurantId: row.EnterpriseID,
      menu: {
        menuId: f.foodCategory.CategoryID,
        category: f.foodCategory.CategoryName,
      },
    }));

    const reviews = row.reviews.map((r) => ({
      id: '',
      rating: r.Rating ?? 0,
      comment: r.Comment ?? '',
      customerName: (r.customer as { FullName?: string })?.FullName ?? 'Anonymous',
      createdAt: r.CreatedAt,
    }));

    const base = this.mapRowToListItem(row);
    return {
      ...base,
      foods,
      reviews,
    };
  }

  async create(
    body: {
      name: string;
      description: string;
      address: string;
      phone: string;
      openHours?: string;
      closeHours?: string;
      isActive?: boolean;
    },
    accountId: string,
  ) {
    return this.repo.create({
      EnterpriseName: body.name,
      Description: body.description,
      Address: body.address,
      PhoneNumber: body.phone,
      OpenHours: body.openHours ?? '08:00',
      CloseHours: body.closeHours ?? '22:00',
      IsActive: body.isActive ?? true,
      AccountID: accountId,
    });
  }

  async update(
    id: string,
    body: {
      name?: string;
      description?: string;
      address?: string;
      phone?: string;
      openHours?: string;
      closeHours?: string;
      isOpen?: boolean;
    },
  ) {
    const exists = await this.repo.findById(id);
    if (!exists) {
      throw new NotFoundException('Restaurant not found');
    }
    const data: Prisma.EnterpriseUpdateInput = {};
    if (body.name !== undefined) data.EnterpriseName = body.name;
    if (body.description !== undefined) data.Description = body.description;
    if (body.address !== undefined) data.Address = body.address;
    if (body.phone !== undefined) data.PhoneNumber = body.phone;
    if (body.openHours !== undefined) data.OpenHours = body.openHours;
    if (body.closeHours !== undefined) data.CloseHours = body.closeHours;
    if (body.isOpen !== undefined) data.IsActive = body.isOpen;
    return this.repo.update(id, data);
  }

  async delete(id: string): Promise<{ message: string }> {
    const exists = await this.repo.findById(id);
    if (!exists) {
      throw new NotFoundException('Restaurant not found');
    }
    await this.repo.delete(id);
    return { message: 'Restaurant deleted successfully' };
  }

  async getCommission(enterpriseId: string): Promise<{ success: boolean; commissionFee?: number; error?: string }> {
    const exists = await this.repo.ensureEnterpriseExists(enterpriseId);
    if (!exists) {
      return { success: false, error: 'Restaurant not found' };
    }
    const rate = await this.repo.getCommissionRate(enterpriseId);
    const commissionFee = rate != null ? rate : 0;
    return { success: true, commissionFee };
  }

  async getReviews(
    enterpriseId: string,
    sort: 'newest' | 'oldest' = 'newest',
    page: number = 1,
    limit: number = RestaurantsRepositoryLimits.defaultReviewsLimit,
  ): Promise<RestaurantReviewsResponse> {
    const exists = await this.repo.ensureEnterpriseExists(enterpriseId);
    if (!exists) {
      throw new NotFoundException('Restaurant not found');
    }

    const safeLimit = Math.min(
      Math.max(limit, 1),
      RestaurantsRepositoryLimits.maxPageSize,
    );
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;

    const [result, averageRating] = await Promise.all([
      this.repo.findReviewsByEnterprise(enterpriseId, sort, skip, safeLimit),
      this.repo.getAverageRating(enterpriseId),
    ]);

    const reviews = result.reviews.map((r) => ({
      id: r.ReviewID,
      author:
        (r.customer as { account?: { Username?: string } })?.account?.Username ??
        'Anonymous',
      rating: r.Rating ?? 0,
      content: r.Comment ?? '',
      images: Array.isArray(r.Images) ? (r.Images as string[]) : [],
      createdAt: r.CreatedAt.toISOString(),
      updatedAt: r.UpdatedAt?.toISOString() ?? null,
    }));

    return {
      reviews,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: result.total,
        totalPages: Math.ceil(result.total / safeLimit),
      },
      averageRating: Math.round(averageRating * 10) / 10,
      totalReviews: result.total,
    };
  }

  private mapRowToListItem(row: {
    EnterpriseID: string;
    EnterpriseName: string;
    Description: string | null;
    Address: string;
    PhoneNumber: string;
    OpenHours: string;
    CloseHours: string;
    IsActive: boolean;
    CreatedAt: Date;
    UpdatedAt: Date | null;
    account: { Avatar: string | null };
    foods: Array<{
      FoodID: string;
      DishName: string;
      Price: unknown;
      ImageURL: string | null;
      foodCategory: { CategoryName: string };
    }>;
    reviews: Array<{ Rating: number | null }>;
    _count: { foods: number; reviews: number };
  }): RestaurantListItem {
    const ratings = row.reviews
      .map((r) => r.Rating)
      .filter((r): r is number => r != null);
    const averageRating =
      ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;

    const popularFoods = row.foods.slice(0, 5).map((f) => ({
      foodId: f.FoodID,
      dishName: f.DishName,
      price: Number(f.Price),
      imageUrl: f.ImageURL ?? '',
      category: f.foodCategory.CategoryName,
    }));

    return {
      id: row.EnterpriseID,
      name: row.EnterpriseName,
      description: row.Description ?? '',
      address: row.Address,
      phone: row.PhoneNumber,
      avatarUrl: row.account?.Avatar ?? '',
      rating: Math.round(averageRating * 10) / 10,
      deliveryTime: DEFAULT_DELIVERY_TIME,
      minimumOrder: DEFAULT_MINIMUM_ORDER,
      isOpen: row.IsActive,
      openHours: row.OpenHours,
      closeHours: row.CloseHours,
      createdAt: row.CreatedAt,
      updatedAt: row.UpdatedAt ?? row.CreatedAt,
      popularFoods,
      totalFoods: row._count.foods,
      totalReviews: row._count.reviews,
    };
  }
}
