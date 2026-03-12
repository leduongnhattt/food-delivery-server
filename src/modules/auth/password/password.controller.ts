import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '@modules/auth/auth.service';
import { AuthPasswordService } from './password.service';

@Controller('auth')
export class AuthPasswordController {
  constructor(
    private readonly authService: AuthService,
    private readonly authPasswordService: AuthPasswordService,
  ) {}

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email?: string }, @Res() res: Response) {
    try {
      const result = await this.authPasswordService.forgotPassword(
        body?.email ?? '',
      );
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
      const result = await this.authPasswordService.resendResetCode(
        body?.email ?? '',
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
      const result = await this.authPasswordService.changePassword(
        decoded.accountId,
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
        message:
          'Password has been changed successfully. Please log in again.',
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Change password error:', error);
      return res.status(500).json({
        error: 'An unexpected error occurred. Please try again.',
      });
    }
  }
}

