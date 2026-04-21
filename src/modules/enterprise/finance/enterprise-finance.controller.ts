import { BadRequestException, Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';
import { EnterpriseFinanceService } from '@modules/enterprise/finance/enterprise-finance.service';

@Controller('enterprise/finance')
export class EnterpriseFinanceController {
  constructor(private readonly service: EnterpriseFinanceService) {}

  private assertAccount(account: JwtPayload | null): asserts account is JwtPayload {
    if (!account?.accountId) throw new BadRequestException('Unauthorized');
  }

  @Post('verify-password')
  @UseGuards(JwtAuthGuard)
  async verifyPassword(
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: { password?: unknown },
  ) {
    this.assertAccount(account);
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!password.trim()) throw new BadRequestException('Password is required');

    const ok = await this.service.verifyPassword(account.accountId, password);
    if (!ok) throw new BadRequestException('Invalid password');

    return { success: true };
  }
}

