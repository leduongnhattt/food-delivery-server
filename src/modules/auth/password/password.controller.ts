import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '@modules/auth/auth.service';
import { AuthPasswordService } from './password.service';
import { JwtAuthGuard } from '@common/guards';
import { CurrentAccount } from '@common/decorators';
import type { JwtPayload } from '@modules/auth/auth.service';

@Controller('auth')
export class AuthPasswordController {
  constructor(
    private readonly authService: AuthService,
    private readonly authPasswordService: AuthPasswordService,
  ) {}

  private optionalJwtEnforceSameEmail(
    req: Request,
    requestedEmail: string,
    res: Response,
  ): Response | null {
    const authHeader = req?.headers?.authorization;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.replace('Bearer ', '')
        : '';
    const decoded = token ? this.authService.verifyAccessToken(token) : null;
    const accountEmail = decoded?.email ? String(decoded.email).trim() : '';
    if (!accountEmail) return null;

    const accountEmailLower = accountEmail.toLowerCase();
    const requestedEmailLower = (requestedEmail || '').trim().toLowerCase();
    if (requestedEmailLower && accountEmailLower !== requestedEmailLower) {
      return res.status(403).json({
        error: 'Email is not associated with the authenticated account',
      });
    }
    return null;
  }

  @Post('forgot-password')
  async forgotPassword(
    @Body() body: { email?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const requested = (body?.email ?? '').trim();

      // Optional JWT check: if user is authenticated, only allow their own email.
      // Do NOT require token (route remains public).
      const enforced = this.optionalJwtEnforceSameEmail(req, requested, res);
      if (enforced) return enforced;

      const result = await this.authPasswordService.forgotPassword(requested);
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

  @Post('resend-reset-code')
  async resendResetCode(
    @Body() body: { email?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const requested = (body?.email ?? '').trim();
      // Optional JWT check: if authenticated, only allow their own email.
      const enforced = this.optionalJwtEnforceSameEmail(req, requested, res);
      if (enforced) return enforced;

      const result = await this.authPasswordService.resendResetCode(
        requested,
      );
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

  @Post('verify-reset-code')
  async verifyResetCode(
    @Body() body: { email?: string; code?: string },
    @Res() res: Response,
  ) {
    try {
      const result = await this.authPasswordService.verifyResetCode(
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

  @Post('reset-password')
  async resetPassword(
    @Body() body: { tokenId?: string; newPassword?: string },
    @Res() res: Response,
  ) {
    try {
      const result = await this.authPasswordService.resetPassword(
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
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentAccount() account: JwtPayload | null,
    @Body() body: { currentPassword?: string; newPassword?: string },
    @Res() res: Response,
  ) {
    try {
      if (!account) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      const result = await this.authPasswordService.changePassword(
        account.accountId,
        body?.currentPassword ?? '',
        body?.newPassword ?? '',
      );
      if (!result.success) {
        const status =
          result.error === 'User account not found'
            ? 404
            : result.error === 'Unauthorized' ||
                result.error === 'Invalid or expired token'
              ? 401
              : 400;
        return res.status(status).json({ error: result.error });
      }
      return res.status(200).json({
        success: true,
        message: 'Password has been changed successfully. Please log in again.',
      });
    } catch (error) {
      console.error('Change password error:', error);
      return res.status(500).json({
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  }
}
