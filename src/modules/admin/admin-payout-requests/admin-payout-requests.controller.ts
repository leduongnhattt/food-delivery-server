import {
  BadRequestException,
  Body,
  Controller,
  Patch,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AdminRoleGuard, JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { AdminPayoutRequestsService } from './admin-payout-requests.service';

@Controller('admin/payout-requests')
export class AdminPayoutRequestsController {
  constructor(private readonly service: AdminPayoutRequestsService) {}

  private assertAdmin(account: JwtPayload | null): asserts account is JwtPayload {
    if (!account?.accountId) throw new BadRequestException('Unauthorized');
    // Role guard is not enforced here because existing admin controllers also rely on route-level auth.
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  async updateStatus(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
    @Body() body: { status?: unknown; adminNote?: unknown; failureMessage?: unknown },
  ) {
    this.assertAdmin(account);
    return this.service.updateStatus(account.accountId, id, body);
  }
}

