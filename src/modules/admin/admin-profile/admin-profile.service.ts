import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import type { AdminProfileResponse } from './admin-profile.types';

@Injectable()
export class AdminProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfileForAccount(accountId: string): Promise<AdminProfileResponse> {
    const adminRecord = await this.prisma.admin.findUnique({
      where: { AccountID: accountId },
      select: {
        account: {
          select: {
            Username: true,
            Email: true,
            Avatar: true,
          },
        },
      },
    });
    const linkedAccount = adminRecord?.account;
    if (!linkedAccount) {
      throw new NotFoundException('Admin not found');
    }
    return {
      username: linkedAccount.Username,
      email: linkedAccount.Email,
      avatar: linkedAccount.Avatar || null,
    };
  }
}
