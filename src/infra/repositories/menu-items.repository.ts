import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

/** List rows: same include graph as legacy `GET /api/menu-items`. */
export const menuItemsListInclude = {
  foodCategory: {
    select: {
      CategoryID: true,
      CategoryName: true,
    },
  },
  menuFoods: {
    include: {
      menu: {
        include: {
          enterprise: {
            select: {
              EnterpriseID: true,
              EnterpriseName: true,
              Address: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.FoodInclude;

export type MenuItemListRow = Prisma.FoodGetPayload<{
  include: typeof menuItemsListInclude;
}>;

/** Detail row: legacy `GET /api/menu-items/:id`. */
export const menuItemsDetailInclude = {
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
} satisfies Prisma.FoodInclude;

export type MenuItemDetailRow = Prisma.FoodGetPayload<{
  include: typeof menuItemsDetailInclude;
}>;

/** Update response: legacy `PUT /api/menu-items/:id`. */
export const menuItemsUpdateInclude = {
  foodCategory: true,
  menuFoods: true,
} satisfies Prisma.FoodInclude;

export type MenuItemUpdateRow = Prisma.FoodGetPayload<{
  include: typeof menuItemsUpdateInclude;
}>;

const listOrderBy: Prisma.FoodOrderByWithRelationInput[] = [
  { foodCategory: { CategoryName: 'asc' } },
  { DishName: 'asc' },
];

export interface MenuItemsListFilterInput {
  restaurantId?: string;
  category?: string;
  search?: string;
  isAvailable?: boolean;
}

/**
 * Data access for menu-items API (Food + menu links).
 * Keeps Prisma shapes in one place for the module.
 */
@Injectable()
export class MenuItemsRepository {
  constructor(private readonly prisma: PrismaService) {}

  buildListWhere(filters: MenuItemsListFilterInput): Prisma.FoodWhereInput {
    const where: Prisma.FoodWhereInput = {};

    if (filters.restaurantId) {
      where.menuFoods = {
        some: {
          menu: { EnterpriseID: filters.restaurantId },
        },
      };
    }

    if (filters.category) {
      where.foodCategory = { CategoryName: filters.category };
    }

    if (filters.search) {
      where.OR = [
        { DishName: { contains: filters.search } },
        { Description: { contains: filters.search } },
      ];
    }

    if (filters.isAvailable !== undefined) {
      where.IsAvailable = filters.isAvailable;
    }

    return where;
  }

  findManyForList(
    where: Prisma.FoodWhereInput,
    skip: number,
    take: number,
  ): Promise<MenuItemListRow[]> {
    return this.prisma.food.findMany({
      where,
      include: menuItemsListInclude,
      orderBy: listOrderBy,
      skip,
      take,
    });
  }

  countForList(where: Prisma.FoodWhereInput): Promise<number> {
    return this.prisma.food.count({ where });
  }

  findByIdForDetail(foodId: string): Promise<MenuItemDetailRow | null> {
    return this.prisma.food.findUnique({
      where: { FoodID: foodId },
      include: menuItemsDetailInclude,
    });
  }

  findEnterpriseById(
    enterpriseId: string,
  ): Promise<{ EnterpriseID: string } | null> {
    return this.prisma.enterprise.findFirst({
      where: { EnterpriseID: enterpriseId, DeletedAt: null },
      select: { EnterpriseID: true },
    });
  }

  findCategoryIdByName(
    categoryName: string,
  ): Promise<{ CategoryID: string } | null> {
    return this.prisma.foodCategory.findFirst({
      where: { CategoryName: categoryName },
      select: { CategoryID: true },
    });
  }

  createForListResponse(params: {
    dishName: string;
    description: string;
    price: number;
    imageUrl: string | null;
    foodCategoryId: string;
    enterpriseId: string;
    isAvailable: boolean;
  }): Promise<MenuItemListRow> {
    return this.prisma.food.create({
      data: {
        DishName: params.dishName,
        Description: params.description,
        Price: params.price,
        ImageURL: params.imageUrl,
        FoodCategoryID: params.foodCategoryId,
        EnterpriseID: params.enterpriseId,
        IsAvailable: params.isAvailable,
      },
      include: menuItemsListInclude,
    });
  }

  findFirstMenuIdForEnterprise(
    enterpriseId: string,
  ): Promise<{ MenuID: string } | null> {
    return this.prisma.menu.findFirst({
      where: { EnterpriseID: enterpriseId },
      orderBy: { CreatedAt: 'asc' },
      select: { MenuID: true },
    });
  }

  tryCreateMenuFoodLink(foodId: string, menuId: string): Promise<void> {
    return this.prisma.menuFood
      .create({
        data: { FoodID: foodId, MenuID: menuId },
      })
      .then(() => undefined)
      .catch(() => undefined);
  }

  updateById(
    foodId: string,
    data: Prisma.FoodUpdateInput,
  ): Promise<MenuItemUpdateRow> {
    return this.prisma.food.update({
      where: { FoodID: foodId },
      data,
      include: menuItemsUpdateInclude,
    });
  }

  deleteById(foodId: string): Promise<void> {
    return this.prisma.food
      .delete({ where: { FoodID: foodId } })
      .then(() => undefined);
  }
}
