import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { EnterpriseIncomeService } from '@modules/enterprise/income/enterprise-income.service';

@Controller('enterprise/income')
export class EnterpriseIncomeController {
  constructor(private readonly service: EnterpriseIncomeService) {}

  private assertEnterprise(account: JwtPayload | null): asserts account is JwtPayload {
    if (!account?.accountId) throw new BadRequestException('Unauthorized');
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  async summary(@CurrentAccount() account: JwtPayload | null) {
    this.assertEnterprise(account);
    return this.service.getSummary(account.accountId);
  }

  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  async transactions(
    @CurrentAccount() account: JwtPayload | null,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('moneyFlow') moneyFlow?: string,
    @Query('types') types?: string,
    @Query('searchOrderId') searchOrderId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    this.assertEnterprise(account);
    return this.service.listTransactions(account.accountId, {
      from,
      to,
      moneyFlow,
      types,
      searchOrderId,
      limit,
      cursor,
    });
  }

  @Get('ledger/:ledgerEntryId')
  @UseGuards(JwtAuthGuard)
  async getLedgerEntry(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ledgerEntryId') ledgerEntryId: string,
  ) {
    this.assertEnterprise(account);
    return this.service.getLedgerEntryDetail(account.accountId, ledgerEntryId);
  }

  @Post('ledger/:ledgerEntryId/cancel-withdrawal')
  @UseGuards(JwtAuthGuard)
  async cancelWithdrawal(
    @CurrentAccount() account: JwtPayload | null,
    @Param('ledgerEntryId') ledgerEntryId: string,
  ) {
    this.assertEnterprise(account);
    return this.service.cancelPendingWithdrawalByLedgerEntry(account.accountId, ledgerEntryId);
  }

  @Post('withdraw')
  @UseGuards(JwtAuthGuard)
  async withdraw(
    @CurrentAccount() account: JwtPayload | null,
    @Body()
    body: {
      payoutDestinationId?: unknown;
      settlementId?: unknown;
      reason?: unknown;
    },
  ) {
    this.assertEnterprise(account);
    return this.service.createWithdrawRequest(account.accountId, body);
  }
}

