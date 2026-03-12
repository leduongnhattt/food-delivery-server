import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { AuthService } from '@modules/auth/auth.service';
import { AuthGoogleService } from '@modules/auth/google/google.service';
import {
  getGoogleAuthorizePageHtml,
  getGoogleCallbackPageHtml,
  type GoogleCallbackMessage,
} from '@infra/templates/oauth.templates';

interface GoogleAccount {
  AccountID: string;
  Username: string;
  Email: string;
  Status: string;
  role?: { RoleName: string } | null;
}

@Controller('auth')
export class AuthGoogleController {
  constructor(
    private readonly authService: AuthService,
    private readonly authGoogleService: AuthGoogleService,
  ) {}

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
      const googleUser = await this.authGoogleService.verifyGoogleToken(
        body.credential,
      );
      let user: GoogleAccount | null;
      try {
        user = await this.authGoogleService.findOrCreateGoogleUser(googleUser);
      } catch (err) {
        // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
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
      process.env.FRONTEND_ORIGIN ||
      process.env.CORS_ORIGIN ||
      'http://localhost:3000';
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
      if (
        !process.env.GOOGLE_CLIENT_ID ||
        !process.env.GOOGLE_CLIENT_SECRET
      ) {
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
      // eslint-disable-next-line no-console
      console.error('Google callback error:', err);
      return sendHtml({
        type: 'GOOGLE_AUTH_ERROR',
        error: 'Failed to authenticate with Google',
      });
    }
  }
}

