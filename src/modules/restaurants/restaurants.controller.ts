import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { RestaurantsService } from '@modules/restaurants/restaurants.service';
import { AuthService } from '@modules/auth/auth.service';

@Controller('restaurants')
export class RestaurantsController {
  constructor(
    private readonly restaurantsService: RestaurantsService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  async list(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('isOpen') isOpenStr?: string,
    @Query('minRating') minRatingStr?: string,
  ) {
    const page = pageStr != null ? parseInt(pageStr, 10) : undefined;
    const limit = limitStr != null ? parseInt(limitStr, 10) : undefined;
    const isOpen =
      isOpenStr === undefined ? undefined : isOpenStr === 'true';
    const minRating =
      minRatingStr != null ? parseInt(minRatingStr, 10) : undefined;

    return this.restaurantsService.findMany({
      page: Number.isNaN(page) ? undefined : page,
      limit: Number.isNaN(limit) ? undefined : limit,
      search: search || undefined,
      category: category || undefined,
      isOpen,
      minRating: Number.isNaN(minRating as number) ? undefined : minRating,
    });
  }

  @Get(':id/reviews')
  async getReviews(
    @Param('id') id: string,
    @Query('sort') sort?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const sortOrder =
      sort === 'oldest' ? 'oldest' : 'newest';
    const page = pageStr != null ? parseInt(pageStr, 10) : 1;
    const limit = limitStr != null ? parseInt(limitStr, 10) : 50;
    return this.restaurantsService.getReviews(
      id,
      sortOrder,
      Number.isNaN(page) ? 1 : page,
      Number.isNaN(limit) ? 50 : limit,
    );
  }

  @Get(':id/commission')
  async getCommission(@Param('id') id: string) {
    return this.restaurantsService.getCommission(id);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.restaurantsService.findById(id);
  }

  @Post()
  async create(@Req() req: Request, @Body() body: any) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token);
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const {
      name,
      description,
      address,
      phone,
      openHours,
      closeHours,
      isActive,
    } = body ?? {};

    if (!name || !description || !address || !phone) {
      throw new BadRequestException(
        'Name, description, address, and phone are required',
      );
    }

    const created = await this.restaurantsService.create(
      {
        name,
        description,
        address,
        phone,
        openHours,
        closeHours,
        isActive,
      },
      decoded.accountId,
    );
    return created;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const {
      name,
      description,
      address,
      phone,
      openHours,
      closeHours,
      isOpen,
    } = body ?? {};
    return this.restaurantsService.update(id, {
      name,
      description,
      address,
      phone,
      openHours,
      closeHours,
      isOpen,
    });
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.restaurantsService.delete(id);
  }
}
