import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { AuthService } from '@modules/auth/auth.service';
import { AuthPasswordService } from '@modules/auth/password/password.service';
import { AuthRepository } from '@infra/repositories/auth.repository';
import type { Request, Response } from 'express';

interface RegisterBody {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

interface LoginBody {
  username?: string;
  password?: string;
}

interface BasicAccount {
  AccountID: string;
  Username: string;
  Email: string;
  Status: string;
  PasswordHash?: string | null;
  role?: { RoleName: string } | null;
  customer?: unknown;
}

function parseCookies(
  cookieHeader: string | undefined,
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [name, ...rest] = part.split('=');
    if (!name) continue;
    const key = name.trim();
    const value = rest.join('=').trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authRepo: AuthRepository,
    private readonly authPasswordService: AuthPasswordService,
  ) {}

  @Post('register')
  async register(@Body() body: RegisterBody, @Res() res: Response) {
    try {
      const { username, email, password, confirmPassword } = body ?? {};

      if (!username || !email || !password || !confirmPassword) {
        return res.status(400).json({
          error: 'signup.errors.validationFailed',
        });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({
          error: 'Passwords do not match',
          field: 'confirmPassword',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          error: 'Password must be at least 6 characters long.',
          field: 'password',
        });
      }

      if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
        return res.status(400).json({
          error: 'Password must contain at least one special character.',
          field: 'password',
        });
      }

      if (!/\d/.test(password)) {
        return res.status(400).json({
          error: 'Password must contain at least one number.',
          field: 'password',
        });
      }

      if (!/[a-zA-Z]/.test(password)) {
        return res.status(400).json({
          error: 'Password must contain at least one letter.',
          field: 'password',
        });
      }

      const existingUsername = (await this.authService.findAccountByUsername(
        username,
      )) as BasicAccount | null;
      if (existingUsername) {
        return res.status(400).json({
          error: 'signup.errors.usernameExists',
          field: 'username',
        });
      }

      const existingEmail = await this.authRepo.findAccountByEmail(email);
      if (existingEmail) {
        return res.status(400).json({
          error: 'signup.errors.emailExists',
          field: 'email',
        });
      }

      const passwordHash =
        await this.authPasswordService.hashPassword(password);
      const account = (await this.authService.createAccount({
        username,
        email,
        passwordHash,
      })) as BasicAccount;

      return res.status(201).json({
        success: true,
        message: 'signup.success.welcomeMessage',
        account: {
          id: account.AccountID,
          username: account.Username,
          email: account.Email,
          role: account.role?.RoleName,
          status: account.Status,
          customer: account.customer,
        },
      });
    } catch (error) {
      console.error('Registration error:', error);
      return res.status(500).json({
        error: 'signup.errors.unexpectedError',
        message:
          error instanceof Error
            ? error.message
            : 'signup.errors.unexpectedError',
      });
    }
  }

  @Post('login')
  async login(@Body() body: LoginBody, @Res() res: Response) {
    try {
      const { username, password } = body ?? {};

      if (!username || !password) {
        return res.status(400).json({
          error: 'Username and password are required',
        });
      }

      const account = (await this.authService.findAccountByUsername(
        username,
      )) as BasicAccount | null;
      if (!account) {
        return res.status(401).json({
          error:
            'Username does not exist. Please check your username or create a new account.',
        });
      }

      const passwordHash = account.PasswordHash ?? '';
      const isPasswordValid = await this.authPasswordService.verifyPassword(
        password,
        passwordHash,
      );
      if (!isPasswordValid) {
        return res.status(401).json({
          error:
            'Incorrect password. Please check your password and try again.',
        });
      }

      const roleRecord = await this.authRepo.findAccountById(
        account.AccountID,
        {
          withRole: true,
        },
      );
      const roleName = roleRecord?.role?.RoleName ?? 'Customer';

      const roleLower = (roleName || '').toLowerCase();

      if (roleLower === 'enterprise') {
        const block = await this.authService.getEnterpriseLoginBlockReason(
          account.AccountID,
        );
        if (block) {
          return res.status(403).json({
            error: block.message,
            code: block.code,
          });
        }
      } else if (roleLower === 'customer' && account.Status === 'Inactive') {
        return res.status(403).json({
          error: 'Your account is locked. Please contact support.',
          code: 'ACCOUNT_LOCKED',
        });
      }

      const { accessToken, refreshToken, expiredAt } =
        await this.authService.issueTokens(
          account.AccountID,
          roleName,
          'email',
        );

      res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        expires: expiredAt,
      });

      return res.status(200).json({
        success: true,
        user: {
          id: account.AccountID,
          username: account.Username,
          email: account.Email,
          role: roleName,
          status: account.Status,
        },
        accessToken,
      });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({
        error: 'Login failed',
      });
    }
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res() res: Response) {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const refreshToken = cookies['refresh_token'];
      let accountId = (req.headers['x-account-id'] as string) || '';

      if (!refreshToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!accountId) {
        accountId =
          (await this.authService.getAccountIdFromRefreshToken(refreshToken)) ??
          '';
      }

      if (!accountId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const accessToken = await this.authService.rotateAccessTokenFromRefresh(
        accountId,
        refreshToken,
      );
      if (!accessToken) {
        return res.status(401).json({ error: 'Invalid refresh' });
      }

      return res.status(200).json({ accessToken });
    } catch (error) {
      console.error('Refresh error:', error);
      return res.status(500).json({ error: 'Refresh failed' });
    }
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const refreshToken = cookies['refresh_token'];

      res.cookie('refresh_token', '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        expires: new Date(0),
      });

      if (!refreshToken) {
        return res.status(200).json({ success: true });
      }

      const accountId =
        await this.authService.getAccountIdFromRefreshToken(refreshToken);
      if (accountId) {
        await this.authService.revokeAllRefreshTokensForAccount(accountId);
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Logout error:', error);
      return res.status(200).json({ success: true });
    }
  }
}
