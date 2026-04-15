import { Controller, Get, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get('summary')
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  summary(
    @CurrentAccount() account: JwtPayload | null,
    @Query('range') range?: string,
  ) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.adminDashboardService.getSummary({ range });
  }
}

