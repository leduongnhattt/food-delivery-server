import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import {
  CreateMenuDto,
  EnterpriseMenuService,
  UpdateMenuDto,
} from '@modules/enterprise/menu/enterprise-menu.service';

@Controller('enterprise')
export class EnterpriseMenuController {
  constructor(private readonly service: EnterpriseMenuService) {}

  @Get('menu')
  async list(@Query('enterpriseId') enterpriseId: string) {
    return this.service.listByEnterpriseId(enterpriseId);
  }

  @Post('menu')
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: CreateMenuDto,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.create(account.accountId, body);
  }

  @Put('menu')
  @UseGuards(JwtAuthGuard)
  async update(
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: UpdateMenuDto,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.update(account.accountId, body);
  }

  @Delete('menu')
  @UseGuards(JwtAuthGuard)
  async remove(
    @CurrentAccount() account: JwtPayload | null,
    @Query('menuId') menuId: string,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.remove(account.accountId, menuId);
  }
}

