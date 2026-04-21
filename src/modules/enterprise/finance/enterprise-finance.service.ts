import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { AuthPasswordService } from '@modules/auth/password/password.service';

@Injectable()
export class EnterpriseFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authPassword: AuthPasswordService,
  ) {}

  async verifyPassword(accountId: string, password: string): Promise<boolean> {
    const row = await this.prisma.account.findUnique({
      where: { AccountID: accountId },
      select: { PasswordHash: true, RoleID: true, role: { select: { RoleName: true } } },
    });
    if (!row) throw new NotFoundException('Account not found');
    const hash = row.PasswordHash ?? '';
    if (!hash) return false;
    return this.authPassword.verifyPassword(password, hash);
  }
}

