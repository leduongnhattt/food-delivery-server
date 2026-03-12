import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { AuthService } from '@modules/auth/auth.service';
import { AuthRepository } from '@infra/repositories/auth.repository';
import type { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import {
  getGoogleAuthorizePageHtml,
  getGoogleCallbackPageHtml,
  type GoogleCallbackMessage,
} from '@infra/templates/oauth.templates';

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

interface GoogleAccount {
  AccountID: string;
  Username: string;
  Email: string;
  Status: string;
  role?: { RoleName: string } | null;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
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

      const passwordHash = await this.authService.hashPassword(password);
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
      // eslint-disable-next-line no-console
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
      const isPasswordValid = await this.authService.verifyPassword(
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
      if (
        (roleLower === 'customer' || roleLower === 'enterprise') &&
        account.Status === 'Inactive'
      ) {
        return res.status(403).json({
          error: 'Your account is locked. Please contact support.',
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
      // eslint-disable-next-line no-console
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
        accountId = (await this.authService.getAccountIdFromRefreshToken(refreshToken)) ?? '';
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
      // eslint-disable-next-line no-console
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

      const accountId = await this.authService.getAccountIdFromRefreshToken(refreshToken);
      if (accountId) {
        await this.authService.revokeAllRefreshTokensForAccount(accountId);
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Logout error:', error);
      return res.status(200).json({ success: true });
    }
  }

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

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email?: string }, @Res() res: Response) {
    try {
      const result = await this.authService.forgotPassword(body?.email ?? '');
      if (result.error) {
        const status = result.error.includes('Too many') ? 429 : 400;
        return res.status(status).json({ error: result.error });
      }
      return res.status(200).json({
        success: true,
        message:
          'If an account with this email exists, a reset code has been sent.',
      });
    } catch (error) {
      console.error('Forgot password error:', error);
      return res.status(500).json({
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  }

  @Post('verify-reset-code')
  async verifyResetCode(
    @Body() body: { email?: string; code?: string },
    @Res() res: Response,
  ) {
    try {
      const result = await this.authService.verifyResetCode(
        body?.email ?? '',
        body?.code ?? '',
      );
      if (!result.success) {
        return res
          .status(400)
          .json({ error: result.error ?? 'Invalid or expired reset code' });
      }
      return res.status(200).json({
        success: true,
        message: 'Reset code verified successfully',
        tokenId: result.tokenId,
      });
    } catch (error) {
      console.error('Verify reset code error:', error);
      return res.status(500).json({
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  }

  @Post('resend-reset-code')
  async resendResetCode(
    @Body() body: { email?: string },
    @Res() res: Response,
  ) {
    try {
      const result = await this.authService.resendResetCode(body?.email ?? '');
      if (result.error) {
        const status = result.error.includes('Too many') ? 429 : 404;
        return res.status(status).json({ error: result.error });
      }
      return res.status(200).json({
        success: true,
        message: 'New reset code has been sent to your email',
      });
    } catch (error) {
      console.error('Resend reset code error:', error);
      return res.status(500).json({
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  }

  @Post('reset-password')
  async resetPassword(
    @Body() body: { tokenId?: string; newPassword?: string },
    @Res() res: Response,
  ) {
    try {
      const result = await this.authService.resetPassword(
        body?.tokenId ?? '',
        body?.newPassword ?? '',
      );
      if (!result.success) {
        return res.status(400).json({
          error: result.error ?? 'Invalid or expired reset token',
        });
      }
      return res.status(200).json({
        success: true,
        message:
          'Password has been reset successfully. Please log in with your new password.',
      });
    } catch (error) {
      console.error('Reset password error:', error);
      return res.status(500).json({
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  }

  @Post('change-password')
  async changePassword(
    @Req() req: Request,
    @Body() body: { currentPassword?: string; newPassword?: string },
    @Res() res: Response,
  ) {
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
      const result = await this.authService.changePassword(
        decoded.accountId,
        body?.currentPassword ?? '',
        body?.newPassword ?? '',
      );
      if (!result.success) {
        const status =
          result.error === 'User account not found'
            ? 404
            : result.error === 'Unauthorized' || result.error === 'Invalid or expired token'
              ? 401
              : 400;
        return res.status(status).json({ error: result.error });
      }
      return res.status(200).json({
        success: true,
        message:
          'Password has been changed successfully. Please log in again.',
      });
    } catch (error) {
      console.error('Change password error:', error);
      return res.status(500).json({
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  }

  @Post('google')
  async googleLogin(
    @Body() body: { credential?: string },
    @Res() res: Response,
  ) {
    try {
      if (!body?.credential) {
        return res.status(400).json({
          error: 'Google credential is required',
        });
      }
      const googleUser = await this.authService.verifyGoogleToken(
        body.credential,
      );
      let user: GoogleAccount | null;
      try {
        user = await this.authService.findOrCreateGoogleUser(googleUser);
      } catch (err) {
        console.error('Google user creation error:', err);
        return res.status(400).json({
          error:
            err instanceof Error ? err.message : 'Failed to create user account',
        });
      }
      if (!user?.role || user.role.RoleName !== 'Customer') {
        return res.status(403).json({
          error: 'Access denied. This login is for customers only.',
        });
      }
      const { accessToken, refreshToken, expiredAt } =
        await this.authService.issueTokens(
          user.AccountID,
          user.role?.RoleName ?? 'Customer',
          'google',
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
          id: user.AccountID,
          username: user.Username,
          email: user.Email,
          role: user.role?.RoleName ?? 'Customer',
          status: user.Status,
        },
        accessToken,
      });
    } catch (error) {
      console.error('Google login error:', error);
      return res.status(500).json({
        error: 'Google authentication failed',
      });
    }
  }

  @Get('google/authorize')
  googleAuthorize(@Res() res: Response) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      console.warn(
        '[auth] GOOGLE_CLIENT_ID is not set. Add it to food-delivery-server/.env',
      );
      return res.status(500).send('Google OAuth not configured');
    }
    let baseUrl =
      process.env.API_URL ||
      process.env.SERVER_PUBLIC_URL ||
      `http://localhost:${process.env.PORT || 3001}`;
    baseUrl = baseUrl.replace(/\/$/, ''); // no trailing slash
    const redirectUri = `${baseUrl}/api/auth/google/callback`;
    console.log(
      '[Google OAuth] Add this EXACT URL in Google Console → Authorized redirect URIs:\n  ' +
        redirectUri,
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'email profile');
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('access_type', 'offline');
    const html = getGoogleAuthorizePageHtml(url.toString());
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const frontendOrigin =
      process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || 'http://localhost:3000';
    const targetOrigin = frontendOrigin.split(',')[0].trim();

    const sendHtml = (messageData: GoogleCallbackMessage) => {
      const html = getGoogleCallbackPageHtml(messageData, targetOrigin);
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    };

    if (error) {
      return sendHtml({
        type: 'GOOGLE_AUTH_ERROR',
        error: 'Google authentication was denied or failed',
      });
    }
    if (!code) {
      return sendHtml({
        type: 'GOOGLE_AUTH_ERROR',
        error: 'Authorization code is missing',
      });
    }
    try {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return sendHtml({
          type: 'GOOGLE_AUTH_ERROR',
          error: 'OAuth configuration error',
        });
      }
      const baseUrl = (
        process.env.API_URL ||
        process.env.SERVER_PUBLIC_URL ||
        `http://localhost:${process.env.PORT || 3001}`
      ).replace(/\/$/, '');
      const redirectUri = `${baseUrl}/api/auth/google/callback`;
      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri,
      );
      const { tokens } = await oauth2Client.getToken(code);
      const idToken = tokens.id_token;
      if (!idToken) {
        return sendHtml({
          type: 'GOOGLE_AUTH_ERROR',
          error: 'ID token not received from Google',
        });
      }
      return sendHtml({
        type: 'GOOGLE_AUTH_SUCCESS',
        credential: idToken,
      });
    } catch (err) {
      console.error('Google callback error:', err);
      return sendHtml({
        type: 'GOOGLE_AUTH_ERROR',
        error: 'Failed to authenticate with Google',
      });
    }
  }
}

