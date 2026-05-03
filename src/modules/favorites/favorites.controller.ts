import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { FavoritesService } from '@modules/favorites/favorites.service';

@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get('restaurants')
  @UseGuards(JwtAuthGuard)
  async listRestaurants(
    @CurrentAccount() jwt: JwtPayload | null,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!jwt?.accountId) {
      throw new UnauthorizedException();
    }
    return this.favoritesService.listRestaurantFavorites(jwt.accountId, { page, limit });
  }

  @Get('restaurants/:restaurantId/status')
  @UseGuards(JwtAuthGuard)
  async restaurantStatus(
    @CurrentAccount() jwt: JwtPayload | null,
    @Param('restaurantId') restaurantId: string,
  ) {
    if (!jwt?.accountId) {
      throw new UnauthorizedException();
    }
    if (!restaurantId) {
      throw new BadRequestException('Missing restaurantId');
    }
    const isFavorite = await this.favoritesService.isRestaurantFavorite(jwt.accountId, restaurantId);
    return { isFavorite };
  }

  @Post('restaurants/:restaurantId')
  @UseGuards(JwtAuthGuard)
  async addRestaurant(
    @CurrentAccount() jwt: JwtPayload | null,
    @Param('restaurantId') restaurantId: string,
  ) {
    if (!jwt?.accountId) {
      throw new UnauthorizedException();
    }
    if (!restaurantId) {
      throw new BadRequestException('Missing restaurantId');
    }
    return this.favoritesService.addRestaurantFavorite(jwt.accountId, restaurantId);
  }

  @Delete('restaurants/:restaurantId')
  @UseGuards(JwtAuthGuard)
  async removeRestaurant(
    @CurrentAccount() jwt: JwtPayload | null,
    @Param('restaurantId') restaurantId: string,
  ) {
    if (!jwt?.accountId) {
      throw new UnauthorizedException();
    }
    if (!restaurantId) {
      throw new BadRequestException('Missing restaurantId');
    }
    return this.favoritesService.removeRestaurantFavorite(jwt.accountId, restaurantId);
  }

  @Get('foods')
  @UseGuards(JwtAuthGuard)
  async listFoods(
    @CurrentAccount() jwt: JwtPayload | null,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!jwt?.accountId) {
      throw new UnauthorizedException();
    }
    return this.favoritesService.listFoodFavorites(jwt.accountId, { page, limit });
  }

  @Get('foods/:foodId/status')
  @UseGuards(JwtAuthGuard)
  async foodStatus(
    @CurrentAccount() jwt: JwtPayload | null,
    @Param('foodId') foodId: string,
  ) {
    if (!jwt?.accountId) {
      throw new UnauthorizedException();
    }
    if (!foodId) {
      throw new BadRequestException('Missing foodId');
    }
    const isFavorite = await this.favoritesService.isFoodFavorite(jwt.accountId, foodId);
    return { isFavorite };
  }

  @Post('foods/:foodId')
  @UseGuards(JwtAuthGuard)
  async addFood(
    @CurrentAccount() jwt: JwtPayload | null,
    @Param('foodId') foodId: string,
  ) {
    if (!jwt?.accountId) {
      throw new UnauthorizedException();
    }
    if (!foodId) {
      throw new BadRequestException('Missing foodId');
    }
    return this.favoritesService.addFoodFavorite(jwt.accountId, foodId);
  }

  @Delete('foods/:foodId')
  @UseGuards(JwtAuthGuard)
  async removeFood(
    @CurrentAccount() jwt: JwtPayload | null,
    @Param('foodId') foodId: string,
  ) {
    if (!jwt?.accountId) {
      throw new UnauthorizedException();
    }
    if (!foodId) {
      throw new BadRequestException('Missing foodId');
    }
    return this.favoritesService.removeFoodFavorite(jwt.accountId, foodId);
  }
}

