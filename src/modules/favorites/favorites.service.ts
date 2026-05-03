import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { CustomersService } from '@modules/customers/customers.service';

const DEFAULT_PAGE_SIZE = 12;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

function normalizePagination(pageRaw?: unknown, limitRaw?: unknown): { page: number; limit: number; skip: number } {
  const pageParsed = typeof pageRaw === 'string' ? parseInt(pageRaw, 10) : Number(pageRaw);
  const limitParsed = typeof limitRaw === 'string' ? parseInt(limitRaw, 10) : Number(limitRaw);
  const page = Number.isFinite(pageParsed) ? Math.max(1, pageParsed) : 1;
  const limit = Number.isFinite(limitParsed)
    ? Math.min(Math.max(limitParsed, MIN_PAGE_SIZE), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export type FavoritesListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type FavoriteRestaurantListItem = {
  id: string;
  name: string;
  description: string;
  address: string;
  phone: string;
  avatarUrl: string;
  isOpen: boolean;
  openHours: string;
  closeHours: string;
  createdAt: string;
  favoritedAt: string;
};

export type FavoriteFoodListItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  isAvailable: boolean;
  restaurantId: string;
  restaurantName: string;
  categoryId: string;
  categoryName: string;
  createdAt: string;
  favoritedAt: string;
};

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
  ) {}

  private async getCustomerIdOrThrow(accountId: string): Promise<string> {
    if (!accountId) {
      throw new BadRequestException('Missing accountId');
    }
    const customer = await this.customersService.ensureCustomerRowForAccount(accountId);
    if (!customer?.CustomerID) {
      throw new NotFoundException('Customer not found');
    }
    return customer.CustomerID;
  }

  async isRestaurantFavorite(accountId: string, restaurantId: string): Promise<boolean> {
    const customerId = await this.getCustomerIdOrThrow(accountId);
    const found = await this.prisma.customerFavoriteEnterprise.findUnique({
      where: {
        CustomerID_EnterpriseID: {
          CustomerID: customerId,
          EnterpriseID: restaurantId,
        },
      },
      select: { FavoriteEnterpriseID: true },
    });
    return !!found;
  }

  async addRestaurantFavorite(accountId: string, restaurantId: string): Promise<{ isFavorite: true }> {
    const customerId = await this.getCustomerIdOrThrow(accountId);
    await this.prisma.customerFavoriteEnterprise.upsert({
      where: {
        CustomerID_EnterpriseID: {
          CustomerID: customerId,
          EnterpriseID: restaurantId,
        },
      },
      create: { CustomerID: customerId, EnterpriseID: restaurantId },
      update: {},
      select: { FavoriteEnterpriseID: true },
    });
    return { isFavorite: true };
  }

  async removeRestaurantFavorite(accountId: string, restaurantId: string): Promise<{ isFavorite: false }> {
    const customerId = await this.getCustomerIdOrThrow(accountId);
    await this.prisma.customerFavoriteEnterprise.deleteMany({
      where: { CustomerID: customerId, EnterpriseID: restaurantId },
    });
    return { isFavorite: false };
  }

  async listRestaurantFavorites(
    accountId: string,
    params?: { page?: unknown; limit?: unknown },
  ): Promise<{ items: FavoriteRestaurantListItem[]; pagination: FavoritesListMeta }> {
    const customerId = await this.getCustomerIdOrThrow(accountId);
    const { page, limit, skip } = normalizePagination(params?.page, params?.limit);

    const [total, rows] = await Promise.all([
      this.prisma.customerFavoriteEnterprise.count({
        where: { CustomerID: customerId },
      }),
      this.prisma.customerFavoriteEnterprise.findMany({
        where: { CustomerID: customerId },
        orderBy: { CreatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          CreatedAt: true,
          enterprise: {
            select: {
              EnterpriseID: true,
              EnterpriseName: true,
              Description: true,
              Address: true,
              PhoneNumber: true,
              IsActive: true,
              OpenHours: true,
              CloseHours: true,
              CreatedAt: true,
              account: { select: { Avatar: true } },
            },
          },
        },
      }),
    ]);

    const items: FavoriteRestaurantListItem[] = rows
      .filter((r) => !!r.enterprise)
      .map((r) => ({
        id: r.enterprise.EnterpriseID,
        name: r.enterprise.EnterpriseName,
        description: r.enterprise.Description ?? '',
        address: r.enterprise.Address,
        phone: r.enterprise.PhoneNumber,
        avatarUrl: r.enterprise.account?.Avatar ?? '',
        isOpen: r.enterprise.IsActive,
        openHours: r.enterprise.OpenHours,
        closeHours: r.enterprise.CloseHours,
        createdAt: r.enterprise.CreatedAt.toISOString(),
        favoritedAt: r.CreatedAt.toISOString(),
      }));

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async isFoodFavorite(accountId: string, foodId: string): Promise<boolean> {
    const customerId = await this.getCustomerIdOrThrow(accountId);
    const found = await this.prisma.customerFavoriteFood.findUnique({
      where: {
        CustomerID_FoodID: {
          CustomerID: customerId,
          FoodID: foodId,
        },
      },
      select: { FavoriteFoodID: true },
    });
    return !!found;
  }

  async addFoodFavorite(accountId: string, foodId: string): Promise<{ isFavorite: true }> {
    const customerId = await this.getCustomerIdOrThrow(accountId);
    await this.prisma.customerFavoriteFood.upsert({
      where: {
        CustomerID_FoodID: {
          CustomerID: customerId,
          FoodID: foodId,
        },
      },
      create: { CustomerID: customerId, FoodID: foodId },
      update: {},
      select: { FavoriteFoodID: true },
    });
    return { isFavorite: true };
  }

  async removeFoodFavorite(accountId: string, foodId: string): Promise<{ isFavorite: false }> {
    const customerId = await this.getCustomerIdOrThrow(accountId);
    await this.prisma.customerFavoriteFood.deleteMany({
      where: { CustomerID: customerId, FoodID: foodId },
    });
    return { isFavorite: false };
  }

  async listFoodFavorites(
    accountId: string,
    params?: { page?: unknown; limit?: unknown },
  ): Promise<{ items: FavoriteFoodListItem[]; pagination: FavoritesListMeta }> {
    const customerId = await this.getCustomerIdOrThrow(accountId);
    const { page, limit, skip } = normalizePagination(params?.page, params?.limit);

    const [total, rows] = await Promise.all([
      this.prisma.customerFavoriteFood.count({
        where: { CustomerID: customerId },
      }),
      this.prisma.customerFavoriteFood.findMany({
        where: { CustomerID: customerId },
        orderBy: { CreatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          CreatedAt: true,
          food: {
            select: {
              FoodID: true,
              DishName: true,
              Description: true,
              Price: true,
              ImageURL: true,
              IsAvailable: true,
              CreatedAt: true,
              enterprise: {
                select: { EnterpriseID: true, EnterpriseName: true },
              },
              foodCategory: {
                select: { CategoryID: true, CategoryName: true },
              },
            },
          },
        },
      }),
    ]);

    const items: FavoriteFoodListItem[] = rows
      .filter((r) => !!r.food)
      .map((r) => ({
        id: r.food.FoodID,
        name: r.food.DishName,
        description: r.food.Description ?? '',
        price: Number(r.food.Price),
        imageUrl: r.food.ImageURL ?? '',
        isAvailable: r.food.IsAvailable,
        restaurantId: r.food.enterprise?.EnterpriseID ?? '',
        restaurantName: r.food.enterprise?.EnterpriseName ?? '',
        categoryId: r.food.foodCategory?.CategoryID ?? '',
        categoryName: r.food.foodCategory?.CategoryName ?? '',
        createdAt: r.food.CreatedAt.toISOString(),
        favoritedAt: r.CreatedAt.toISOString(),
      }));

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

