import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '@modules/auth/auth.service';

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
  async profile(@Req() req: Request, @Res() res: Response) {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader?.replace('Bearer ', '');

      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const decoded = this.authService.verifyAccessToken(token);
      if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const account = (await this.authService.getProfile(
        decoded.accountId,
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
      // eslint-disable-next-line no-console
      console.error('Get profile error:', error);
      return res.status(500).json({ error: 'Failed to get profile' });
    }
  }
}

