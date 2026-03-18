import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
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

  @Get('search')
  async search(
    @Query('q') query?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limitParsed = limitStr != null ? parseInt(limitStr, 10) : NaN;
    const limit = Number.isNaN(limitParsed)
      ? 20
      : Math.min(Math.max(limitParsed || 20, 1), 100);
    return this.foodsService.searchFoods(query ?? '', limit);
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

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.foodsService.getByIdDetailed(id);
  }

  @Post()
  async create(
    @Body()
    body: {
      name?: string;
      description?: string;
      price?: number | string;
      image?: string | null;
      category?: string;
      isAvailable?: boolean;
      restaurantId?: string;
    },
  ) {
    return this.foodsService.createFoodFromMenuItemDto({
      name: body.name ?? '',
      description: body.description ?? '',
      price: body.price ?? '',
      image: body.image,
      category: body.category ?? '',
      isAvailable: body.isAvailable,
      restaurantId: body.restaurantId ?? '',
    });
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      price?: number | string;
      image?: string | null;
      isAvailable?: boolean;
    },
  ) {
    return this.foodsService.updateFoodById(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.foodsService.deleteFoodById(id);
  }
}

