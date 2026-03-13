import { Injectable } from '@nestjs/common';
import { AuthRepository } from '@infra/repositories/auth.repository';
import * as bcrypt from 'bcryptjs';
import { AuthEmailService } from '@modules/auth/auth-email.service';

@Injectable()
export class AuthPasswordService {
  private readonly forgotRateLimit = new Map<
    string,
    { count: number; resetTime: number }
  >();
  private readonly resendRateLimit = new Map<
    string,
    { count: number; resetTime: number }
  >();

  constructor(
    private readonly authRepo: AuthRepository,
    private readonly authEmail: AuthEmailService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  private generateResetCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private checkForgotRateLimit(email: string): boolean {
    const now = Date.now();
    const key = `forgot_password_${email}`;
    const limit = this.forgotRateLimit.get(key);
    if (!limit) {
      this.forgotRateLimit.set(key, { count: 1, resetTime: now + 3600000 });
      return true;
    }
    if (now > limit.resetTime) {
      this.forgotRateLimit.set(key, { count: 1, resetTime: now + 3600000 });
      return true;
    }
    if (limit.count >= 100) return false;
    limit.count++;
    return true;
  }

  private checkResendRateLimit(email: string): boolean {
    const now = Date.now();
    const key = `resend_reset_${email}`;
    const limit = this.resendRateLimit.get(key);
    if (!limit) {
      this.resendRateLimit.set(key, { count: 1, resetTime: now + 60000 });
      return true;
    }
    if (now > limit.resetTime) {
      this.resendRateLimit.set(key, { count: 1, resetTime: now + 60000 });
      return true;
    }
    if (limit.count >= 3) return false;
    limit.count++;
    return true;
  }

  async forgotPassword(
    email: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!email || typeof email !== 'string') {
      return { success: false, error: 'Email is required' };
    }
    if (!this.checkForgotRateLimit(email)) {
      return {
        success: false,
        error: 'Too many reset attempts. Please try again later.',
      };
    }
    const account = await this.authRepo.findActiveCustomerByEmail(email);
    if (!account || account.role?.RoleName !== 'Customer') {
      return { success: true };
    }
    const resetCode = this.generateResetCode();
    const expiresAt = new Date(Date.now() + 60 * 1000);
    await this.authRepo.invalidatePasswordResetTokensForAccount(
      account.AccountID,
    );
    await this.authRepo.createPasswordResetToken({
      AccountID: account.AccountID,
      ResetCode: resetCode,
      ExpiresAt: expiresAt,
    });
    const sent = await this.authEmail.sendPasswordResetCode(
      account.Email,
      resetCode,
      account.Username,
    );
    if (!sent) {
      return {
        success: false,
        error: 'Failed to send reset code. Please try again.',
      };
    }
    return { success: true };
  }

  async verifyResetCode(
    email: string,
    code: string,
  ): Promise<{ success: boolean; tokenId?: string; error?: string }> {
    if (!email || !code) {
      return { success: false, error: 'Email and reset code are required' };
    }
    if (
      typeof code !== 'string' ||
      code.length !== 6 ||
      !/^\d{6}$/.test(code)
    ) {
      return { success: false, error: 'Invalid reset code format' };
    }
    const account = await this.authRepo.findActiveCustomerByEmail(email);
    if (!account || account.role?.RoleName !== 'Customer') {
      return { success: false, error: 'Invalid email or reset code' };
    }
    const resetToken = await this.authRepo.findValidResetTokenByAccountAndCode(
      account.AccountID,
      code,
    );
    if (!resetToken) {
      return { success: false, error: 'Invalid or expired reset code' };
    }
    return { success: true, tokenId: resetToken.TokenID };
  }

  async resendResetCode(
    email: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!email || typeof email !== 'string') {
      return { success: false, error: 'Email is required' };
    }
    if (!this.checkResendRateLimit(email)) {
      return {
        success: false,
        error: 'Too many resend attempts. Please wait a moment.',
      };
    }
    const account = await this.authRepo.findActiveCustomerByEmail(email);
    if (!account || account.role?.RoleName !== 'Customer') {
      return { success: false, error: 'Account not found' };
    }
    const resetCode = this.generateResetCode();
    const expiresAt = new Date(Date.now() + 60 * 1000);
    await this.authRepo.invalidatePasswordResetTokensForAccount(
      account.AccountID,
    );
    await this.authRepo.createPasswordResetToken({
      AccountID: account.AccountID,
      ResetCode: resetCode,
      ExpiresAt: expiresAt,
    });
    const sent = await this.authEmail.sendPasswordResetCode(
      account.Email,
      resetCode,
      account.Username,
    );
    if (!sent) {
      return {
        success: false,
        error: 'Failed to send reset code. Please try again.',
      };
    }
    return { success: true };
  }

  async resetPassword(
    tokenId: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!tokenId || !newPassword) {
      return {
        success: false,
        error: 'Token ID and new password are required',
      };
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return {
        success: false,
        error: 'Password must be at least 6 characters long',
      };
    }
    const resetToken = await this.authRepo.findValidResetTokenById(tokenId);
    if (!resetToken || resetToken.account.role?.RoleName !== 'Customer') {
      return { success: false, error: 'Invalid or expired reset token' };
    }
    const hashed = await this.hashPassword(newPassword);
    await this.authRepo.resetPasswordTx(tokenId, resetToken.AccountID, hashed);
    try {
      await this.authEmail.sendPasswordResetSuccess(
        resetToken.account.Email,
        resetToken.account.Username,
      );
    } catch {
      // ignore
    }
    return { success: true };
  }

  async changePassword(
    accountId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!currentPassword || !newPassword) {
      return {
        success: false,
        error: 'Current password and new password are required',
      };
    }
    if (newPassword.length < 6) {
      return {
        success: false,
        error: 'New password must be at least 6 characters long',
      };
    }
    if (currentPassword === newPassword) {
      return {
        success: false,
        error: 'New password must be different from current password',
      };
    }
    const account = await this.authRepo.findAccountById(accountId);
    if (!account) {
      return { success: false, error: 'User account not found' };
    }
    const hash = account.PasswordHash;
    if (!hash) {
      return { success: false, error: 'User account has no password set' };
    }
    const valid = await this.verifyPassword(currentPassword, hash);
    if (!valid) {
      return { success: false, error: 'Current password is incorrect' };
    }
    const hashed = await this.hashPassword(newPassword);
    await this.authRepo.changePasswordTx(accountId, hashed);
    return { success: true };
  }
}
