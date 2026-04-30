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
  AdminUpdateVoucherBody,
  AdminVouchersService,
} from './admin-vouchers.service';

@Controller('admin')
export class AdminVouchersController {
  constructor(private readonly adminVouchersService: AdminVouchersService) { }

  @Get('vouchers')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  list(
    @CurrentAccount() account: JwtPayload | null,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('range') range?: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    const query = this.adminVouchersService.parseListQuery({
      status,
      q,
      page,
      limit,
      range,
    });
    return this.adminVouchersService.listVouchers(query);
  }

  @Get('vouchers/:voucherId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  getDetail(
    @CurrentAccount() account: JwtPayload | null,
    @Param('voucherId') voucherId: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.adminVouchersService.getVoucherDetail(voucherId);
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

  @Patch('vouchers/:voucherId/reject')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  reject(
    @CurrentAccount() account: JwtPayload | null,
    @Param('voucherId') voucherId: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.adminVouchersService.rejectVoucher(voucherId);
  }

  @Patch('vouchers/:voucherId')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  update(
    @CurrentAccount() account: JwtPayload | null,
    @Param('voucherId') voucherId: string,
    @Body() body: AdminUpdateVoucherBody,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.adminVouchersService.updateVoucher(voucherId, body);
  }
}
