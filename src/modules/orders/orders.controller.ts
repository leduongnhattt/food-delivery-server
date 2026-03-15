import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  Query,
  Req,
  Body,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { OrdersService, type CreateOrderRequestDto } from '@modules/orders/orders.service';
import { AuthService } from '@modules/auth/auth.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  async create(
    @Req() req: Request,
    @Body() body: CreateOrderRequestDto,
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

    return this.ordersService.createForCustomer(decoded.accountId, body);
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
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

    const page = pageStr != null ? parseInt(pageStr, 10) : undefined;
    const limit = limitStr != null ? parseInt(limitStr, 10) : undefined;

    return this.ordersService.listForCustomer(decoded.accountId, {
      status,
      page: Number.isNaN(page) ? undefined : page,
      limit: Number.isNaN(limit) ? undefined : limit,
      startDate,
      endDate,
    });
  }

  @Get(':id')
  async getById(@Req() req: Request, @Param('id') id: string) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token);
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.ordersService.getByIdForCustomer(decoded.accountId, id);
  }

  @Delete(':id')
  async cancel(@Req() req: Request, @Param('id') id: string) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token);
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.ordersService.cancelForCustomer(decoded.accountId, id);
  }

  @Get('track/:id')
  async track(@Req() req: Request, @Param('id') id: string) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token);
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.ordersService.trackForCustomer(decoded.accountId, id);
  }

  @Post(':id/reorder')
  async reorder(@Req() req: Request, @Param('id') id: string) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    const decoded = this.authService.verifyAccessToken(token);
    if (!decoded?.accountId) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.ordersService.reorderForCustomer(decoded.accountId, id);
  }
}

