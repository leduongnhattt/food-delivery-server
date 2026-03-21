import {
  Body,
  Controller,
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

@Controller('admin/voucher')
export class AdminVouchersController {
  constructor(private readonly adminVouchersService: AdminVouchersService) {}

  @Post()
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
}
