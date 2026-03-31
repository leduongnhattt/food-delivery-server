import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import {
  CreateEnterpriseVoucherDto,
  EnterpriseVoucherService,
  UpdateEnterpriseVoucherDto,
} from '@modules/enterprise/voucher/enterprise-voucher.service';

@Controller('enterprise/voucher')
export class EnterpriseVoucherController {
  constructor(private readonly service: EnterpriseVoucherService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: CreateEnterpriseVoucherDto,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.create(account.accountId, body);
  }

  @Put()
  @UseGuards(JwtAuthGuard)
  async update(
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: UpdateEnterpriseVoucherDto,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.update(account.accountId, body);
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  async remove(
    @CurrentAccount() account: JwtPayload | null,
    @Query('voucherId') voucherId: string,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.remove(account.accountId, voucherId);
  }
}

