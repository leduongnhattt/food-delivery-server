import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { EnterpriseOrdersService } from '@modules/enterprise/orders/enterprise-orders.service';

@Controller('enterprise/orders')
export class EnterpriseOrdersController {
  constructor(private readonly service: EnterpriseOrdersService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@CurrentAccount() account: JwtPayload | null) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.list(account.accountId);
  }

  @Get('recent')
  @UseGuards(JwtAuthGuard)
  async recent(@CurrentAccount() account: JwtPayload | null) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.recent(account.accountId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.delete(account.accountId, id);
  }
}

