import { BadRequestException, Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { EnterpriseDashboardService } from '@modules/enterprise/dashboard/enterprise-dashboard.service';

@Controller('enterprise/dashboard')
export class EnterpriseDashboardController {
  constructor(private readonly service: EnterpriseDashboardService) {}

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async stats(@CurrentAccount() account: JwtPayload | null) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.getStats(account.accountId);
  }

  @Get('revenue')
  @UseGuards(JwtAuthGuard)
  async revenue(@CurrentAccount() account: JwtPayload | null) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.getRevenue(account.accountId);
  }
}

