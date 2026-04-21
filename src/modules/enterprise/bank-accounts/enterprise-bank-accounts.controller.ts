import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { EnterpriseBankAccountsService } from './enterprise-bank-accounts.service';

@Controller('enterprise/bank-accounts')
export class EnterpriseBankAccountsController {
  constructor(private readonly service: EnterpriseBankAccountsService) {}

  private assertEnterprise(
    account: JwtPayload | null,
  ): asserts account is JwtPayload & { accountId: string } {
    const role = (account?.role || '').trim().toLowerCase();
    if (!account?.accountId || role !== 'enterprise') {
      throw new BadRequestException('Unauthorized');
    }
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@CurrentAccount() account: JwtPayload | null) {
    this.assertEnterprise(account);
    return this.service.list(account.accountId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: {
      kind?: unknown;
      bankName?: unknown;
      bankCode?: unknown;
      accountHolderName?: unknown;
      accountNumber?: unknown;
      branchName?: unknown;
      countryCode?: unknown;
      providerCode?: unknown;
      walletRef?: unknown;
      walletDisplayName?: unknown;
      isDefault?: unknown;
      label?: unknown;
    },
  ) {
    this.assertEnterprise(account);
    return this.service.create(account.accountId, body);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @CurrentAccount() account: JwtPayload | null,
    @Param('id') id: string,
    @Body()
    body: {
      isDefault?: unknown;
      isActive?: unknown;
      label?: unknown;
      bankName?: unknown;
      bankCode?: unknown;
      accountHolderName?: unknown;
      accountNumber?: unknown;
      branchName?: unknown;
      countryCode?: unknown;
      providerCode?: unknown;
      walletRef?: unknown;
      walletDisplayName?: unknown;
    },
  ) {
    this.assertEnterprise(account);
    return this.service.update(account.accountId, id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(@CurrentAccount() account: JwtPayload | null, @Param('id') id: string) {
    this.assertEnterprise(account);
    return this.service.delete(account.accountId, id);
  }
}

