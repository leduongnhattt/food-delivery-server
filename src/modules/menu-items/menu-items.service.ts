import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MenuItemsRepository } from '@infra/repositories/menu-items.repository';
import type {
  CreateMenuItemBodyDto,
  MenuItemsListQueryDto,
  MenuItemsListResponseDto,
  UpdateMenuItemBodyDto,
} from '@modules/menu-items/dto/menu-items.dto';
import { parseMenuItemsListQuery } from '@modules/menu-items/parsers/menu-items-list.query.parser';
import {
  isLegacyTruthyPrice,
  parseOptionalPriceForUpdate,
  parseRequiredPriceLegacy,
} from '@modules/menu-items/parsers/menu-items-numeric.parser';

/**
 * Application service for menu-items (Food rows exposed with menu–enterprise relations).
 * Mirrors legacy Next.js `/api/menu-items` rules so clients can migrate to Nest without behavior drift.
 */
@Injectable()
export class MenuItemsService {
  constructor(private readonly menuItemsRepository: MenuItemsRepository) {}

  async list(query: MenuItemsListQueryDto): Promise<MenuItemsListResponseDto> {
    const { page, limit, skip, filters } = parseMenuItemsListQuery(query);
    const where = this.menuItemsRepository.buildListWhere(filters);

    const [menuItems, total] = await Promise.all([
      this.menuItemsRepository.findManyForList(where, skip, limit),
      this.menuItemsRepository.countForList(where),
    ]);

    return {
      menuItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(foodId: string) {
    const id = foodId?.trim();
    if (!id) {
      throw new BadRequestException('Menu item id is required');
    }
    const row = await this.menuItemsRepository.findByIdForDetail(id);
    if (!row) {
      throw new NotFoundException('Menu item not found');
    }
    return row;
  }

  async create(body: CreateMenuItemBodyDto) {
    const name = body.name?.trim() ?? '';
    const description = body.description?.trim() ?? '';
    const category = body.category?.trim() ?? '';
    const restaurantId = body.restaurantId?.trim() ?? '';

    if (
      !name ||
      !description ||
      !category ||
      !restaurantId ||
      !isLegacyTruthyPrice(body.price)
    ) {
      throw new BadRequestException(
        'Name, description, price, category, and restaurantId are required',
      );
    }

    const price = parseRequiredPriceLegacy(body.price);
    if (price === null) {
      throw new BadRequestException('Invalid price');
    }

    const restaurant =
      await this.menuItemsRepository.findEnterpriseById(restaurantId);
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const categoryRow =
      await this.menuItemsRepository.findCategoryIdByName(category);
    if (!categoryRow) {
      throw new BadRequestException('Food category not found');
    }

    const imageUrl =
      body.image === undefined || body.image === null
        ? null
        : String(body.image);

    const created = await this.menuItemsRepository.createForListResponse({
      dishName: name,
      description,
      price,
      imageUrl,
      foodCategoryId: categoryRow.CategoryID,
      enterpriseId: restaurantId,
      isAvailable: body.isAvailable ?? true,
    });

    const firstMenu =
      await this.menuItemsRepository.findFirstMenuIdForEnterprise(
        restaurantId,
      );
    if (firstMenu) {
      await this.menuItemsRepository.tryCreateMenuFoodLink(
        created.FoodID,
        firstMenu.MenuID,
      );
    }

    return created;
  }

  async update(foodId: string, body: UpdateMenuItemBodyDto) {
    const id = foodId?.trim();
    if (!id) {
      throw new BadRequestException('Menu item id is required');
    }

    const data: Prisma.FoodUpdateInput = {};

    if (body.name !== undefined) {
      data.DishName = body.name;
    }
    if (body.description !== undefined) {
      data.Description = body.description;
    }
    if (body.image !== undefined) {
      data.ImageURL = body.image;
    }
    if (typeof body.isAvailable === 'boolean') {
      data.IsAvailable = body.isAvailable;
    }

    const priceUpdate = parseOptionalPriceForUpdate(body.price);
    if (priceUpdate !== undefined) {
      data.Price = priceUpdate;
    }

    try {
      return await this.menuItemsRepository.updateById(id, data);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Menu item not found');
      }
      throw error;
    }
  }

  async remove(foodId: string): Promise<{ message: string }> {
    const id = foodId?.trim();
    if (!id) {
      throw new BadRequestException('Menu item id is required');
    }
    try {
      await this.menuItemsRepository.deleteById(id);
      return { message: 'Menu item deleted successfully' };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Menu item not found');
      }
      throw error;
    }
  }
}
