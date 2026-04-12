import { Injectable } from '@nestjs/common';
import { AccountStatus, EnterpriseInvitationStatus } from '@prisma/client';
import { AuthRepository } from '@infra/repositories/auth.repository';
import { AuthPasswordService } from '@modules/auth/password/password.service';
import type { Secret, SignOptions } from 'jsonwebtoken';
import { sign as jwtSign, verify as jwtVerify } from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { PAYMENT_METHOD } from '@common/constants/payment-method.constants';

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

@Injectable()
export class AuthService {
  private readonly accessTokenTtl: string;
  private readonly refreshTokenTtlDays: number;
  private readonly jwtSecret: string;

  constructor(
    private readonly authRepo: AuthRepository,
    private readonly authPassword: AuthPasswordService,
  ) {
    this.accessTokenTtl = process.env.ACCESS_TOKEN_TTL ?? '15m';
    this.refreshTokenTtlDays = Number(
      process.env.REFRESH_TOKEN_TTL_DAYS ?? '7',
    );
    this.jwtSecret = process.env.JWT_SECRET || 'change-me';
  }

  // Account / customer management

  async findAccountByUsername(username: string) {
    return this.authRepo.findAccountByUsername(username);
  }

  getEnterpriseLoginBlockReason(accountId: string): Promise<{
    message: string;
    code: string;
  } | null> {
    return this.enterpriseLoginGate(accountId);
  }

  private async enterpriseLoginGate(accountId: string): Promise<{
    message: string;
    code: string;
  } | null> {
    const noAccountError = {
      message: 'No account was found for these credentials.',
      code: 'ENTERPRISE_NO_ACCOUNT',
    } as const;
    const suspendedAccountError = {
      message:
        'This enterprise account has been suspended. Please contact support.',
      code: 'ENTERPRISE_SUSPENDED',
    } as const;

    const loginContext =
      await this.authRepo.findEnterpriseLoginContext(accountId);
    if (!loginContext) {
      return { ...noAccountError };
    }

    const enterprise = loginContext.enterprise;
    const latestInvitation = loginContext.enterpriseInvitations[0];

    if (enterprise?.DeletedAt) {
      return { ...noAccountError, code: 'ENTERPRISE_DELETED' };
    }

    if (enterprise) {
      if (
        latestInvitation &&
        latestInvitation.Status !== EnterpriseInvitationStatus.Accepted
      ) {
        return { ...noAccountError, code: 'ENTERPRISE_NOT_ACTIVATED' };
      }
      if (loginContext.Status === AccountStatus.Inactive) {
        return { ...suspendedAccountError };
      }
      return null;
    }

    if (
      !latestInvitation ||
      latestInvitation.Status !== EnterpriseInvitationStatus.Accepted
    ) {
      return { ...noAccountError, code: 'ENTERPRISE_NOT_ACTIVATED' };
    }

    return { ...noAccountError, code: 'ENTERPRISE_NOT_ACTIVATED' };
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
      PreferredPaymentMethod: PAYMENT_METHOD.Cash,
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

  async updateAvatar(accountId: string, avatarUrl: string): Promise<void> {
    await this.authRepo.updateAccount(accountId, { Avatar: avatarUrl });
  }

  /** Returns accountId from refresh token (for refresh or logout). */
  async getAccountIdFromRefreshToken(
    refreshToken: string,
  ): Promise<string | null> {
    const token =
      await this.authRepo.findValidAuthTokenByRefreshToken(refreshToken);
    return token?.AccountID ?? null;
  }

  /**
   * Creates an account with Enterprise role and a linked Enterprise record (admin creates restaurant).
   */
  async createAccountForEnterprise(params: {
    username: string;
    email: string;
    password: string;
    enterpriseName: string;
    address: string;
    latitude: number;
    longitude: number;
    phoneNumber: string;
    description?: string;
    openHours: string;
    closeHours: string;
  }): Promise<{
    account: Awaited<ReturnType<AuthRepository['createAccount']>>;
    enterprise: Awaited<ReturnType<AuthRepository['createEnterprise']>>;
  }> {
    const enterpriseRole = await this.authRepo.findRoleByName('Enterprise');
    if (!enterpriseRole) {
      throw new Error('Enterprise role not found');
    }
    const passwordHash = await this.authPassword.hashPassword(params.password);
    const account = await this.authRepo.createAccount({
      Username: params.username,
      Email: params.email,
      PasswordHash: passwordHash,
      RoleID: enterpriseRole.RoleID,
      Avatar: '',
      Status: AccountStatus.Active,
      Provider: 'email',
    });
    const enterprise = await this.authRepo.createEnterprise({
      AccountID: account.AccountID,
      EnterpriseName: params.enterpriseName,
      Address: params.address,
      Latitude: params.latitude,
      Longitude: params.longitude,
      PhoneNumber: params.phoneNumber,
      Description: params.description,
      OpenHours: params.openHours,
      CloseHours: params.closeHours,
    });
    return { account, enterprise };
  }
}
