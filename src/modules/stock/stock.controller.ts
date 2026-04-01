import { BadRequestException, Controller, Post, Body } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

interface StockValidationResult {
  isValid: boolean;
  availableStock: number;
  requestedQuantity: number;
  foodName: string;
  message?: string;
}

@Controller('stock')
export class StockController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('validate')
  async validate(@Body() body: { foodId?: string; requestedQuantity?: number }) {
    const { foodId, requestedQuantity } = body ?? {};
    if (!foodId || !requestedQuantity) {
      throw new BadRequestException('Missing required fields');
    }

    const food = await this.prisma.food.findUnique({
      where: { FoodID: foodId },
      select: { FoodID: true, DishName: true, IsAvailable: true },
    });

    if (!food) {
      const result: StockValidationResult = {
        isValid: false,
        availableStock: 0,
        requestedQuantity,
        foodName: 'Unknown',
        message: 'Food item not found',
      };
      return result;
    }

    if (!food.IsAvailable) {
      const result: StockValidationResult = {
        isValid: false,
        availableStock: 0,
        requestedQuantity,
        foodName: food.DishName,
        message: 'This item is currently unavailable',
      };
      return result;
    }

    const result: StockValidationResult = {
      isValid: true,
      availableStock: Number.POSITIVE_INFINITY,
      requestedQuantity,
      foodName: food.DishName,
    };
    return result;
  }
}

