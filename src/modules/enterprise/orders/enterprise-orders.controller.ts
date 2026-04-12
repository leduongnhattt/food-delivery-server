import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { EnterpriseOrdersService } from '@modules/enterprise/orders/enterprise-orders.service';

@Controller('enterprise/orders')
export class EnterpriseOrdersController {
  constructor(private readonly service: EnterpriseOrdersService) {}

  private assertEnterprise(account: JwtPayload | null): asserts account is JwtPayload & {
    accountId: string;
  } {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@CurrentAccount() account: JwtPayload | null) {
    this.assertEnterprise(account);
    return this.service.list(account.accountId);
  }

  @Get('recent')
  @UseGuards(JwtAuthGuard)
  async recent(@CurrentAccount() account: JwtPayload | null) {
    this.assertEnterprise(account);
    return this.service.recent(account.accountId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getById(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
  ) {
    this.assertEnterprise(account);
    return this.service.getById(account.accountId, id);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  async updateStatus(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
    @Body() body: { status?: unknown },
  ) {
    this.assertEnterprise(account);
    return this.service.updateStatus(account.accountId, id, body);
  }

  @Patch(':id/delivery-method')
  @UseGuards(JwtAuthGuard)
  async updateDeliveryMethod(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
    @Body() body: { deliveryMethod?: unknown },
  ) {
    this.assertEnterprise(account);
    return this.service.updateDeliveryMethod(account.accountId, id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
  ) {
    this.assertEnterprise(account);
    return this.service.delete(account.accountId, id);
  }
}
