import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { CategoriesService } from '@modules/categories/categories.service';
import { AuthService } from '@modules/auth/auth.service';

@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  async list(@Query('enterpriseId') enterpriseId?: string) {
    return this.categoriesService.list({ enterpriseId: enterpriseId || undefined });
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body() body: { categoryName?: string; description?: string | null },
  ) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token);
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if ((decoded.role || '').trim().toLowerCase() !== 'admin') {
      throw new UnauthorizedException('Admin access required');
    }

    return this.categoriesService.create({
      accountId: decoded.accountId,
      categoryName: body.categoryName || '',
      description: body.description ?? null,
    });
  }
}

