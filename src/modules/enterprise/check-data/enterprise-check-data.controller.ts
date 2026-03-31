import { BadRequestException, Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { EnterpriseCheckDataService } from '@modules/enterprise/check-data/enterprise-check-data.service';

@Controller('enterprise')
export class EnterpriseCheckDataController {
  constructor(private readonly service: EnterpriseCheckDataService) {}

  @Get('check-data')
  @UseGuards(JwtAuthGuard)
  async get(@CurrentAccount() account: JwtPayload | null) {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
    return this.service.run(account.accountId);
  }
}

