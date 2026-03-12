import { Injectable } from '@nestjs/common';
import {
  FoodsRepository,
  FoodListCriteria,
  FoodsRepositoryLimits,
} from '@infra/repositories/foods.repository';
import { getKeyJson, setKeyJson } from '@infra/redis/redis.service';

/** Default image path when food has no image. */
const DEFAULT_FOOD_IMAGE = '/images/default-food.jpg';

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

export interface FoodByIdsItem {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  restaurantId: string;
  category: string;
  description: string;
  restaurantName: string;
}

export interface FoodsListResponse {
  foods: FoodListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@Injectable()
export class FoodsService {
  constructor(private readonly foodsRepository: FoodsRepository) {}

  async findMany(criteria: FoodsQueryDto): Promise<FoodsListResponse> {
    const where = this.foodsRepository.buildWhereFromCriteria(
      criteria as FoodListCriteria,
    );
    const { page, limit, skip } = this.foodsRepository.normalizePagination(
      criteria.page,
      criteria.limit,
    );

    const [foodRows, totalCount] = await Promise.all([
      this.foodsRepository.findManyWithCategoryAndEnterprise(
        where,
        [{ Stock: 'desc' }, { CreatedAt: 'desc' }],
        skip,
        limit,
      ),
      this.foodsRepository.count(where),
    ]);

    const foodListItems: FoodListItem[] = foodRows.map((row) =>
      this.mapRowToFoodListItem(row),
    );

    return {
      foods: foodListItems,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  async findPopular(criteria: FoodsQueryDto): Promise<FoodsListResponse> {
    return this.findMany(criteria);
  }

  /**
   * Search foods by keyword (for app search box).
   * Response shape aligned with Next.js /api/foods/search for compatibility.
   */
  async searchFoods(
    searchQuery: string,
    limitParam: number,
  ): Promise<FoodsSearchResult> {
    const trimmedKeyword = searchQuery?.trim() ?? '';
    const take = Math.min(
      Math.max(limitParam || FoodsRepositoryLimits.defaultSearchLimit, 1),
      FoodsRepositoryLimits.maxPageSize,
    );

    if (!trimmedKeyword) {
      return {
        foods: [],
        total: 0,
        query: '',
        cached: false,
      };
    }

    const cacheKey = `food_search:${trimmedKeyword.toLowerCase()}:${take}`;
    const cached = await getKeyJson<FoodsSearchResult>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const rows = await this.foodsRepository.searchAvailableByKeyword(
      trimmedKeyword,
      take,
    );

    const searchItems = rows.map((row) => ({
      foodId: row.FoodID,
      dishName: row.DishName,
      description: row.Description ?? '',
      price: Number(row.Price),
      stock: row.Stock ?? 0,
      imageUrl: row.ImageURL ?? DEFAULT_FOOD_IMAGE,
      restaurantId: row.EnterpriseID,
      menu: {
        menuId: row.FoodID,
        category: row.foodCategory?.CategoryName ?? 'Food',
      },
      enterprise: row.enterprise
        ? {
            EnterpriseID: row.enterprise.EnterpriseID,
            EnterpriseName: row.enterprise.EnterpriseName,
          }
        : null,
    }));

    const result: FoodsSearchResult = {
      foods: searchItems,
      total: rows.length,
      query: trimmedKeyword,
      cached: false,
    };
    // Best-effort cache; ignore errors.
    try {
      await setKeyJson(cacheKey, result, 300);
    } catch {
      // no-op
    }
    return result;
  }

  async findByIds(ids: string[]): Promise<{ foods: FoodByIdsItem[] }> {
    const rows =
      await this.foodsRepository.findByIdsWithCategoryAndEnterprise(
        Array.isArray(ids) ? ids : [],
      );

    const items: FoodByIdsItem[] = rows.map((row) => ({
      id: row.FoodID,
      name: row.DishName,
      price: Number(row.Price),
      imageUrl: row.ImageURL ?? DEFAULT_FOOD_IMAGE,
      restaurantId: row.EnterpriseID,
      category: row.foodCategory?.CategoryName ?? '',
      description: row.Description ?? '',
      restaurantName: row.enterprise?.EnterpriseName ?? '',
    }));

    return { foods: items };
  }

  private mapRowToFoodListItem(row: {
    FoodID: string;
    DishName: string;
    Price: unknown;
    Stock: number;
    IsAvailable: boolean;
    Description: string | null;
    ImageURL: string | null;
    foodCategory: { CategoryID: string; CategoryName: string };
    enterprise: {
      EnterpriseID: string;
      EnterpriseName: string;
      Address: string;
      PhoneNumber: string;
      OpenHours: string;
      CloseHours: string;
      IsActive: boolean;
    };
  }): FoodListItem {
    return {
      foodId: row.FoodID,
      dishName: row.DishName,
      price: Number(row.Price),
      stock: row.Stock,
      isAvailable: row.IsAvailable,
      description: row.Description ?? '',
      imageUrl: row.ImageURL ?? DEFAULT_FOOD_IMAGE,
      restaurantId: row.enterprise.EnterpriseID,
      menu: {
        menuId: row.foodCategory.CategoryID,
        category: row.foodCategory.CategoryName,
      },
      restaurant: {
        id: row.enterprise.EnterpriseID,
        name: row.enterprise.EnterpriseName,
        address: row.enterprise.Address,
        phone: row.enterprise.PhoneNumber,
        openHours: row.enterprise.OpenHours,
        closeHours: row.enterprise.CloseHours,
        isActive: row.enterprise.IsActive,
      },
    };
  }
}
