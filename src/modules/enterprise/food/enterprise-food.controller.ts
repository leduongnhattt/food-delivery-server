import {
  Body,
  Controller,
  Delete,
  Query,
  Put,
  Post,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import {
  EnterpriseFoodService,
  CreateEnterpriseFoodDto,
  UpdateEnterpriseFoodDto,
} from '@modules/enterprise/food/enterprise-food.service';

@Controller('enterprise')
export class EnterpriseFoodController {
  constructor(private readonly service: EnterpriseFoodService) {}

  @Post('food')
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: CreateEnterpriseFoodDto,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.create(account.accountId, body);
  }

  @Put('food')
  @UseGuards(JwtAuthGuard)
  async update(
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: UpdateEnterpriseFoodDto,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.update(account.accountId, body);
  }

  @Delete('food')
  @UseGuards(JwtAuthGuard)
  async remove(
    @CurrentAccount() account: JwtPayload | null,
    @Query('foodId') foodId: string,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.remove(account.accountId, foodId);
  }
}

