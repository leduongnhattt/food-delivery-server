import {
  Controller,
  Get,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AdminRoleGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { AdminProfileService } from './admin-profile.service';

@Controller('admin/profile')
export class AdminProfileController {
  constructor(private readonly adminProfileService: AdminProfileService) {}

  @Get()
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  get(@CurrentAccount() account: JwtPayload | null) {
    if (!account?.accountId) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.adminProfileService.getProfileForAccount(account.accountId);
  }
}
