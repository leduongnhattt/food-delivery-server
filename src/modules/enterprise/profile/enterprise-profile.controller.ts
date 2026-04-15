import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import {
  EnterpriseProfileInclude,
  EnterpriseProfileService,
  UpdateEnterpriseProfileDto,
} from '@modules/enterprise/profile/enterprise-profile.service';

function parseInclude(value: string | null): EnterpriseProfileInclude {
  if (value === 'menus' || value === 'foods' || value === 'vouchers') return value;
  return null;
}

@Controller('enterprise/profile')
export class EnterpriseProfileController {
  constructor(private readonly service: EnterpriseProfileService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async get(
    @CurrentAccount() account: JwtPayload | null,
    @Query('include') includeRaw?: string,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    const include = parseInclude(includeRaw ?? null);
    return this.service.getProfile(account.accountId, include);
  }

  @Put()
  @UseGuards(JwtAuthGuard)
  async update(
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: UpdateEnterpriseProfileDto,
  ) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.updateProfile(account.accountId, body);
  }
}

