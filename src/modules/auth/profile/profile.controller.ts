import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService, type JwtPayload } from '@modules/auth/auth.service';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';

interface ProfileAccount {
  AccountID: string;
  Email: string;
  Username: string;
  Avatar: string | null;
  Status: string;
  CreatedAt: Date;
  UpdatedAt: Date;
  role?: { RoleName: string } | null;
  customer?: unknown;
}

@Controller('auth')
export class AuthProfileController {
  constructor(private readonly authService: AuthService) {}

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async profile(
    @CurrentAccount() accountToken: JwtPayload | null,
    @Res() res: Response,
  ) {
    try {
      const account = (await this.authService.getProfile(
        accountToken?.accountId ?? '',
      )) as ProfileAccount | null;
      if (!account) {
        return res.status(404).json({ error: 'Account not found' });
      }

      return res.status(200).json({
        account: {
          id: account.AccountID,
          email: account.Email,
          username: account.Username,
          avatar: account.Avatar,
          status: account.Status,
          role: account.role?.RoleName,
          createdAt: account.CreatedAt,
          updatedAt: account.UpdatedAt,
        },
        customer: account.customer,
      });
    } catch (error) {
      console.error('Get profile error:', error);
      return res.status(500).json({ error: 'Failed to get profile' });
    }
  }
}
