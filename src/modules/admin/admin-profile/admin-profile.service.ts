import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

@Injectable()
export class AdminProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfileForAccount(accountId: string): Promise<{
    username: string;
    email: string;
    avatar: string | null;
  }> {
    const admin = await this.prisma.admin.findUnique({
      where: { AccountID: accountId },
      select: {
        AdminID: true,
        account: {
          select: {
            Username: true,
            Email: true,
            Avatar: true,
          },
        },
      },
    });
    if (!admin?.account) {
      throw new NotFoundException('Admin not found');
    }
    return {
      username: admin.account.Username,
      email: admin.account.Email,
      avatar: admin.account.Avatar || null,
    };
  }
}
