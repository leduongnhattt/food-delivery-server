import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import {
  AdminCreateVoucherBody,
  AdminVouchersService,
} from './admin-vouchers.service';

@Controller('admin')
export class AdminVouchersController {
  constructor(private readonly adminVouchersService: AdminVouchersService) {}

  @Get('vouchers')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  list(
    @CurrentAccount() account: JwtPayload | null,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    const query = this.adminVouchersService.parseListQuery({ status, q, limit });
    return this.adminVouchersService.listVouchers(query);
  }

  @Post('voucher')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  create(
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: AdminCreateVoucherBody,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.adminVouchersService.createVoucher(account.accountId, body);
  }

  @Patch('vouchers/:voucherId/approve')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  approve(
    @CurrentAccount() account: JwtPayload | null,
    @Param('voucherId') voucherId: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.adminVouchersService.approveVoucher(voucherId);
  }
}
