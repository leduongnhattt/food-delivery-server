import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { FoodsService } from '@modules/foods/foods.service';

@Controller('foods')
export class FoodsController {
  constructor(private readonly foodsService: FoodsService) {}

  @Get()
  async list(
    @Query('limit') limitStr?: string,
    @Query('page') pageStr?: string,
    @Query('restaurantId') restaurantId?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('isAvailable') isAvailable?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    const limit =
      limitStr != null
        ? Math.min(Math.max(parseInt(limitStr, 10) || 10, 1), 100)
        : 10;
    const page =
      pageStr != null ? Math.max(parseInt(pageStr, 10) || 1, 1) : 1;
    const isAvailableParsed =
      isAvailable === undefined ? undefined : isAvailable === 'true';
    return this.foodsService.findMany({
      limit,
      page,
      restaurantId,
      category,
      search,
      isAvailable: isAvailableParsed,
      minPrice: minPrice != null ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice != null ? parseFloat(maxPrice) : undefined,
    });
  }

  @Get('popular')
  async popular(
    @Query('limit') limitStr?: string,
    @Query('page') pageStr?: string,
    @Query('restaurantId') restaurantId?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('isAvailable') isAvailable?: string,
  ) {
    const limit =
      limitStr != null
        ? Math.min(Math.max(parseInt(limitStr, 10) || 10, 1), 100)
        : 10;
    const page =
      pageStr != null ? Math.max(parseInt(pageStr, 10) || 1, 1) : 1;
    const isAvailableParsed =
      isAvailable === undefined ? undefined : isAvailable === 'true';
    return this.foodsService.findPopular({
      limit,
      page,
      restaurantId,
      category,
      search,
      isAvailable: isAvailableParsed,
    });
  }

  @Post('by-ids')
  async byIds(@Body() body: { ids?: string[] }) {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    return this.foodsService.findByIds(ids);
  }
}

