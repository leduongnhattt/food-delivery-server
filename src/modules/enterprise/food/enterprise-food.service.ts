import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

export interface CreateEnterpriseFoodDto {
  DishName: string;
  Description?: string;
  Price: number;
  ImageURL?: string;
  FoodCategoryID: string;
  IsAvailable?: boolean;
}

export interface UpdateEnterpriseFoodDto {
  FoodID: string;
  DishName: string;
  Description?: string;
  Price: number;
  ImageURL?: string;
  FoodCategoryID: string;
  IsAvailable?: boolean;
}

@Injectable()
export class EnterpriseFoodService {
  constructor(private readonly prisma: PrismaService) {}

  private async getEnterpriseIdByAccountId(accountId: string): Promise<string> {
    const enterprise = await this.prisma.enterprise.findFirst({
      where: { AccountID: accountId, DeletedAt: null },
      select: { EnterpriseID: true },
    });
    if (!enterprise) throw new BadRequestException('Enterprise profile not found');
    return enterprise.EnterpriseID;
  }

  async create(accountId: string, dto: CreateEnterpriseFoodDto) {
    const { DishName, Price, FoodCategoryID } = dto;
    if (!DishName || Price == null || !FoodCategoryID) {
      throw new BadRequestException(
        'Dish name, price, and category are required',
      );
    }

    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const dish = await this.prisma.food.create({
      data: {
        DishName: dto.DishName,
        Description: dto.Description,
        Price: dto.Price,
        ImageURL: dto.ImageURL,
        FoodCategoryID: dto.FoodCategoryID,
        EnterpriseID: enterpriseId,
        IsAvailable: typeof dto.IsAvailable === 'boolean' ? dto.IsAvailable : true,
      },
    });

    return { dish };
  }

  async update(accountId: string, dto: UpdateEnterpriseFoodDto) {
    if (!dto.FoodID) {
      throw new BadRequestException('FoodId is required');
    }
    if (!dto.DishName || dto.Price == null || !dto.FoodCategoryID) {
      throw new BadRequestException(
        'Dish name, price, and category are required',
      );
    }

    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const existingFood = await this.prisma.food.findUnique({
      where: { FoodID: dto.FoodID },
      select: { FoodID: true, EnterpriseID: true },
    });
    if (!existingFood || existingFood.EnterpriseID !== enterpriseId) {
      throw new BadRequestException('Food not found');
    }

    const dish = await this.prisma.food.update({
      where: { FoodID: dto.FoodID },
      data: {
        DishName: dto.DishName,
        Description: dto.Description,
        Price: dto.Price,
        ImageURL: dto.ImageURL,
        FoodCategoryID: dto.FoodCategoryID,
        EnterpriseID: enterpriseId,
        IsAvailable:
          typeof dto.IsAvailable === 'boolean' ? dto.IsAvailable : undefined,
      },
    });

    return { dish };
  }

  async remove(accountId: string, foodId: string) {
    if (!foodId) throw new BadRequestException('Food ID is required');

    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);

    const existingFood = await this.prisma.food.findUnique({
      where: { FoodID: foodId },
      select: { FoodID: true, EnterpriseID: true },
    });
    if (!existingFood || existingFood.EnterpriseID !== enterpriseId) {
      throw new BadRequestException('Food not found');
    }

    await this.prisma.food.delete({ where: { FoodID: foodId } });
    return { success: true };
  }
}

