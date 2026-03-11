import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

export interface FoodsQueryDto {
  limit?: number;
  page?: number;
  restaurantId?: string;
  category?: string;
  search?: string;
  isAvailable?: boolean;
  minPrice?: number;
  maxPrice?: number;
}

export interface FoodListItem {
  foodId: string;
  dishName: string;
  price: number;
  stock: number;
  isAvailable: boolean;
  description: string;
  imageUrl: string;
  restaurantId: string;
  menu: { menuId: string; category: string };
  restaurant: {
    id: string;
    name: string;
    address: string;
    phone: string;
    openHours: string;
    closeHours: string;
    isActive: boolean;
  };
}

export interface FoodsSearchResult {
  foods: Array<{
    foodId: string;
    dishName: string;
    description: string;
    price: number;
    stock: number;
    imageUrl: string;
    restaurantId: string;
    menu: { menuId: string; category: string };
    enterprise: {
      EnterpriseID: string;
      EnterpriseName: string;
    } | null;
  }>;
  total: number;
  query: string;
  cached: boolean;
}

@Injectable()
export class FoodsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: FoodsQueryDto) {
    const limit = Math.min(Math.max(query.limit ?? 10, 1), 100);
    const page = Math.max(query.page ?? 1, 1);
    const skip = (page - 1) * limit;

    const where: Prisma.FoodWhereInput = {
      IsAvailable: query.isAvailable !== undefined ? query.isAvailable : true,
    };
    if (query.restaurantId) where.EnterpriseID = query.restaurantId;
    if (query.category) {
      where.foodCategory = { CategoryName: query.category };
    }
    if (query.search) {
      where.OR = [
        { DishName: { contains: query.search } },
        { Description: { contains: query.search } },
      ];
    }
    if (query.minPrice != null || query.maxPrice != null) {
      where.Price = {};
      if (query.minPrice != null) where.Price.gte = query.minPrice;
      if (query.maxPrice != null) where.Price.lte = query.maxPrice;
    }

    const [foods, total] = await Promise.all([
      this.prisma.food.findMany({
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
        orderBy: [{ Stock: 'desc' }, { CreatedAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.food.count({ where }),
    ]);

    const transformedFoods: FoodListItem[] = foods.map((food) => ({
      foodId: food.FoodID,
      dishName: food.DishName,
      price: Number(food.Price),
      stock: food.Stock,
      isAvailable: food.IsAvailable,
      description: food.Description ?? '',
      imageUrl: food.ImageURL ?? '',
      restaurantId: food.enterprise.EnterpriseID,
      menu: {
        menuId: food.foodCategory.CategoryID,
        category: food.foodCategory.CategoryName,
      },
      restaurant: {
        id: food.enterprise.EnterpriseID,
        name: food.enterprise.EnterpriseName,
        address: food.enterprise.Address,
        phone: food.enterprise.PhoneNumber,
        openHours: food.enterprise.OpenHours,
        closeHours: food.enterprise.CloseHours,
        isActive: food.enterprise.IsActive,
      },
    }));

    return {
      foods: transformedFoods,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findPopular(query: FoodsQueryDto) {
    return this.findMany(query);
  }

  /**
   * Search foods by keyword (for app search box).
   * Logic aligned with Next.js route /api/foods/search to keep response shape.
   */
  async searchFoods(query: string, limit: number): Promise<FoodsSearchResult> {
    const trimmedQuery = query?.trim() ?? '';
    const normalizedLimit = Math.min(Math.max(limit || 20, 1), 100);

    if (!trimmedQuery) {
      return {
        foods: [],
        total: 0,
        query: '',
        cached: false,
      };
    }

    const foods = await this.prisma.food.findMany({
      where: {
        OR: [
          { DishName: { contains: trimmedQuery } },
          {
            foodCategory: {
              CategoryName: { contains: trimmedQuery },
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
      take: normalizedLimit,
      orderBy: { DishName: 'asc' },
    });

    return {
      foods: foods.map((food) => ({
        foodId: food.FoodID,
        dishName: food.DishName,
        description: food.Description || '',
        price: Number(food.Price),
        stock: food.Stock || 0,
        imageUrl: food.ImageURL || '/images/default-food.jpg',
        restaurantId: food.EnterpriseID,
        menu: {
          menuId: food.FoodID,
          category: food.foodCategory?.CategoryName || 'Food',
        },
        enterprise: food.enterprise
          ? {
              EnterpriseID: food.enterprise.EnterpriseID,
              EnterpriseName: food.enterprise.EnterpriseName,
            }
          : null,
      })),
      total: foods.length,
      query: trimmedQuery,
      cached: false,
    };
  }

  async findByIds(ids: string[]) {
    if (!ids?.length) return { foods: [] };
    const foods = await this.prisma.food.findMany({
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
    return {
      foods: foods.map((food) => ({
        id: food.FoodID,
        name: food.DishName,
        price: Number(food.Price),
        imageUrl: food.ImageURL ?? '',
        restaurantId: food.EnterpriseID,
        category: food.foodCategory?.CategoryName ?? '',
        description: food.Description ?? '',
        restaurantName: food.enterprise?.EnterpriseName ?? '',
      })),
    };
  }
}

