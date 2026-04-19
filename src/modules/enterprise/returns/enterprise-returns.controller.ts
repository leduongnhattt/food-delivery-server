import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { EnterpriseReturnsService } from '@modules/enterprise/returns/enterprise-returns.service';

@Controller('enterprise/returns')
export class EnterpriseReturnsController {
  constructor(private readonly service: EnterpriseReturnsService) {}

  private assertEnterprise(account: JwtPayload | null): asserts account is JwtPayload & { accountId: string } {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(
    @CurrentAccount() account: JwtPayload | null,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
  ) {
    this.assertEnterprise(account);
    return this.service.list(account.accountId, { status, startDate, endDate, search });
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  async updateStatus(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
    @Body() body: { status?: unknown; internalNote?: unknown },
  ) {
    this.assertEnterprise(account);
    return this.service.updateStatus(account.accountId, id, body);
  }
}

