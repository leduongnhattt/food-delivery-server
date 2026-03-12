import { Injectable } from '@nestjs/common';
import { AuthRepository } from '@infra/repositories/auth.repository';
import * as bcrypt from 'bcryptjs';
import type { Secret, SignOptions } from 'jsonwebtoken';
import { sign as jwtSign, verify as jwtVerify } from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { AuthEmailService } from '@modules/auth/auth-email.service';

export type JwtPayload = {
  accountId: string;
  role: string;
  username?: string;
  email?: string;
  status?: string;
  provider?: string;
};

type JwtSignFn = (
  payload: string | Buffer | object,
  secretOrPrivateKey: Secret,
  options?: SignOptions,
) => string;

const safeJwtSign: JwtSignFn = jwtSign as unknown as JwtSignFn;

type JwtVerifyFn = (token: string, secretOrPublicKey: Secret) => unknown;

const safeJwtVerify: JwtVerifyFn = jwtVerify as unknown as JwtVerifyFn;

export interface GoogleUserInfo {
  email: string;
  googleId: string;
  name: string;
  picture?: string;
}

@Injectable()
export class AuthService {
  private readonly accessTokenTtl: string;
  private readonly refreshTokenTtlDays: number;
  private readonly jwtSecret: string;
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
  ) {
    this.accessTokenTtl = process.env.ACCESS_TOKEN_TTL ?? '15m';
    this.refreshTokenTtlDays = Number(
      process.env.REFRESH_TOKEN_TTL_DAYS ?? '7',
    );
    this.jwtSecret = process.env.JWT_SECRET || 'change-me';
  }

  // Password management

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // Account / customer management

  async findAccountByUsername(username: string) {
    return this.authRepo.findAccountByUsername(username);
  }

  async createAccount(params: {
    username: string;
    email: string;
    passwordHash: string;
  }): Promise<any> {
    const customerRole = await this.authRepo.findRoleByName('Customer');
    if (!customerRole) {
      throw new Error('Customer role not found');
    }
    const account = await this.authRepo.createAccount({
      Username: params.username,
      Email: params.email,
      PasswordHash: params.passwordHash,
      RoleID: customerRole.RoleID,
      Avatar: '',
      Status: 'Active',
    });
    const customer = await this.authRepo.createCustomer({
      AccountID: account.AccountID,
      FullName: params.username,
      PhoneNumber: '00000000000',
      Address: 'Default Address',
      PreferredPaymentMethod: 'Cash',
    });
    return { ...account, customer };
  }

  async createCustomer(params: {
    accountId: string;
    fullName: string;
    phoneNumber: string;
    address: string;
    dateOfBirth?: string;
    gender?: 'Male' | 'Female' | 'Other';
    preferredPaymentMethod?: 'Cash' | 'CreditCard' | 'MoMo' | 'BankTransfer';
  }): Promise<any> {
    return this.authRepo.createCustomer({
      AccountID: params.accountId,
      FullName: params.fullName,
      PhoneNumber: params.phoneNumber,
      Address: params.address,
      DateOfBirth: params.dateOfBirth ? new Date(params.dateOfBirth) : null,
      Gender: params.gender || null,
      PreferredPaymentMethod: params.preferredPaymentMethod || 'Cash',
    });
  }

  // Token management

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private addDays(date: Date, days: number): Date {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  private signAccessToken(payload: JwtPayload): string {
    return safeJwtSign(payload, this.jwtSecret, {
      expiresIn: this.accessTokenTtl,
    });
  }

  private cryptoRandom(): string {
    return randomBytes(32).toString('base64url');
  }

  async issueTokens(
    accountId: string,
    role: string,
    provider: string = 'email',
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiredAt: Date;
  }> {
    const account = await this.authRepo.findAccountById(accountId, {
      withRole: true,
    });
    const accessToken = this.signAccessToken({
      accountId,
      role: account?.role?.RoleName || role,
      username: account?.Username ?? undefined,
      email: account?.Email ?? undefined,
      status: account?.Status ?? undefined,
      provider,
    });
    const rawRefreshToken = this.cryptoRandom();
    const now = new Date();
    const expiredAt = this.addDays(now, this.refreshTokenTtlDays);
    await this.authRepo.createAuthToken({
      AccountID: accountId,
      RefreshToken: rawRefreshToken,
      AccessToken: this.hashToken(accessToken),
      CreatedAt: now,
      ExpiredAt: expiredAt,
    });
    return { accessToken, refreshToken: rawRefreshToken, expiredAt };
  }

  async rotateAccessTokenFromRefresh(
    accountId: string,
    refreshToken: string,
  ): Promise<string | null> {
    const existing = await this.authRepo.findValidAuthToken(
      accountId,
      refreshToken,
    );
    if (!existing) return null;
    if (existing.ExpiredAt <= new Date()) return null;
    const account = await this.authRepo.findAccountById(accountId, {
      withRole: true,
    });
    if (!account) return null;
    const newAccessToken = this.signAccessToken({
      accountId,
      role: account.role?.RoleName || 'customer',
      username: account.Username ?? undefined,
      email: account.Email ?? undefined,
      status: account.Status ?? undefined,
    });
    await this.authRepo.updateAuthTokenAccessToken(
      accountId,
      refreshToken,
      this.hashToken(newAccessToken),
    );
    return newAccessToken;
  }

  async revokeAllRefreshTokensForAccount(accountId: string): Promise<void> {
    await this.authRepo.revokeAllAuthTokensForAccount(accountId);
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

  private generateUsernameFromEmail(email: string): string {
    const prefix = email.split('@')[0].toLowerCase();
    const clean = prefix
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return clean.length < 3 ? `user_${clean}` : clean;
  }

  private getGoogleClient(): OAuth2Client {
    return new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
  }

  async verifyGoogleToken(idToken: string): Promise<GoogleUserInfo> {
    const client = this.getGoogleClient();
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.sub) {
      throw new Error('Invalid Google token payload');
    }
    return {
      email: payload.email,
      googleId: payload.sub,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture,
    };
  }

  private async findGoogleUserByGoogleId(googleId: string) {
    return this.authRepo.findAccountByGoogleId(googleId);
  }

  private async findAccountByEmail(email: string) {
    return this.authRepo.findAccountByEmail(email, true);
  }

  private async linkGoogleToExistingAccount(
    accountId: string,
    googleUser: GoogleUserInfo,
  ) {
    await this.authRepo.updateAccount(accountId, {
      Provider: 'google',
      ProviderAccountId: googleUser.googleId,
      EmailVerified: true,
      LastLogin: new Date(),
      Avatar: googleUser.picture || undefined,
    });
    const existing = await this.authRepo.findCustomerByAccountId(accountId);
    if (!existing) {
      try {
        await this.createCustomer({
          accountId,
          fullName: googleUser.name,
          phoneNumber: '00000000000',
          address: 'Default Address',
          preferredPaymentMethod: 'Cash',
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '';
        if (
          msg.includes('CUSTOMER_PhoneNumber') ||
          msg.includes('PhoneNumber')
        ) {
          await this.createCustomer({
            accountId,
            fullName: googleUser.name,
            phoneNumber: '00000000001',
            address: 'Default Address',
            preferredPaymentMethod: 'Cash',
          });
        } else {
          throw e;
        }
      }
    }
    return this.authRepo.findAccountById(accountId, { withRole: true });
  }

  private async createGoogleAccount(googleUser: GoogleUserInfo) {
    const customerRole = await this.authRepo.findRoleByName('Customer');
    if (!customerRole) throw new Error('Customer role not found');
    const username = this.generateUsernameFromEmail(googleUser.email);
    const existing = await this.authRepo.findAccountByUsernameRaw(username);
    if (existing) {
      throw new Error(
        `Username '${username}' already exists. Please contact support.`,
      );
    }
    const newAccount = await this.authRepo.createAccount({
      Username: username,
      Email: googleUser.email,
      PasswordHash: '', // Google accounts have no password
      RoleID: customerRole.RoleID,
      Avatar: googleUser.picture || '',
      Status: 'Active',
      Provider: 'google',
      ProviderAccountId: googleUser.googleId,
      EmailVerified: true,
      LastLogin: new Date(),
    });
    const phone = '00000000000';
    try {
      await this.authRepo.createCustomer({
        AccountID: newAccount.AccountID,
        FullName: googleUser.name,
        PhoneNumber: phone,
        Address: 'Default Address',
        PreferredPaymentMethod: 'Cash',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('CUSTOMER_PhoneNumber') || msg.includes('PhoneNumber')) {
        await this.authRepo.createCustomer({
          AccountID: newAccount.AccountID,
          FullName: googleUser.name,
          PhoneNumber: '00000000001',
          Address: 'Default Address',
          PreferredPaymentMethod: 'Cash',
        });
      } else {
        throw e;
      }
    }
    return newAccount;
  }

  async findOrCreateGoogleUser(googleUser: GoogleUserInfo) {
    const existing = await this.findGoogleUserByGoogleId(googleUser.googleId);
    if (existing) {
      await this.authRepo.updateAccountLastLogin(existing.AccountID);
      const updated = await this.authRepo.findAccountById(existing.AccountID, {
        withRole: true,
      });
      return updated ?? existing;
    }
    const byEmail = await this.findAccountByEmail(googleUser.email);
    if (byEmail) {
      return this.linkGoogleToExistingAccount(byEmail.AccountID, googleUser);
    }
    return this.createGoogleAccount(googleUser);
  }

  verifyAccessToken(token: string): JwtPayload | null {
    try {
      const decoded = safeJwtVerify(token, this.jwtSecret);
      return decoded as JwtPayload;
    } catch {
      return null;
    }
  }

  /** Returns account and customer for profile (used by controller). */
  async getProfile(accountId: string) {
    return this.authRepo.findAccountById(accountId, {
      withRole: true,
      withCustomer: true,
    });
  }

  /** Returns accountId from refresh token (for refresh or logout). */
  async getAccountIdFromRefreshToken(
    refreshToken: string,
  ): Promise<string | null> {
    const token =
      await this.authRepo.findValidAuthTokenByRefreshToken(refreshToken);
    return token?.AccountID ?? null;
  }
}
