import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { AdminTransactionFeesService } from './admin-transaction-fees.service';

@Controller('admin/finance/transaction-fees')
export class AdminTransactionFeesController {
  constructor(private readonly service: AdminTransactionFeesService) {}

  @Get('global')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  getGlobal(@CurrentAccount() account: JwtPayload | null) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.getGlobal();
  }

  @Patch('global')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  patchGlobal(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: {
      ruleName?: unknown;
      ratePercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.updateGlobal(account.accountId, body);
  }

  @Get('channel-rules')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  listChannelRules(
    @CurrentAccount() account: JwtPayload | null,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('paymentChannel') paymentChannel?: string,
    @Query('isActive') isActive?: string,
    @Query('effectiveFrom') effectiveFrom?: string,
    @Query('effectiveTo') effectiveTo?: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    const q = this.service.parseListQuery({
      page,
      pageSize,
      search,
      paymentChannel,
      isActive,
      effectiveFrom,
      effectiveTo,
    });
    return this.service.listChannelRules(q);
  }

  @Post('channel-rules')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  createChannelRule(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: {
      paymentChannel?: unknown;
      feeName?: unknown;
      ratePercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.createChannelRule(account.accountId, body);
  }

  @Get('channel-rules/:feeId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  getChannelRule(
    @CurrentAccount() account: JwtPayload | null,
    @Param('feeId') feeId: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.getChannelRule(feeId);
  }

  @Patch('channel-rules/:feeId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  patchChannelRule(
    @CurrentAccount() account: JwtPayload | null,
    @Param('feeId') feeId: string,
    @Body()
    body: {
      paymentChannel?: unknown;
      feeName?: unknown;
      ratePercent?: unknown;
      isActive?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.service.updateChannelRule(account.accountId, feeId, body);
  }
}
