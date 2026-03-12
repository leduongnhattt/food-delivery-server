import { Injectable } from '@nestjs/common';
import { Prisma, AccountStatus, Gender, PaymentMethod } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

/**
 * Auth repository: centralizes access to Account, AuthToken, PasswordResetToken, Role, Customer.
 * Centralized under infra/repositories for project-wide data access.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- Account ---
  findAccountByUsername(username: string) {
    return this.prisma.account.findFirst({
      where: { Username: username },
    });
  }

  findAccountById(accountId: string, options?: { withRole?: boolean; withCustomer?: boolean }) {
    return this.prisma.account.findUnique({
      where: { AccountID: accountId },
      select: {
        AccountID: true,
        Email: true,
        Username: true,
        PasswordHash: true,
        Avatar: true,
        Status: true,
        CreatedAt: true,
        UpdatedAt: true,
        LastLogin: true,
        Provider: true,
        ProviderAccountId: true,
        ...(options?.withRole && {
          role: { select: { RoleName: true } },
        }),
        ...(options?.withCustomer && {
          customer: true,
        }),
      },
    });
  }

  findAccountByEmail(email: string, withRole = false) {
    return this.prisma.account.findFirst({
      where: { Email: email },
      include: { role: withRole },
    });
  }

  findActiveCustomerByEmail(email: string) {
    return this.prisma.account.findFirst({
      where: { Email: email.toLowerCase(), Status: 'Active' },
      include: { role: true },
    });
  }

  findAccountByGoogleId(googleId: string) {
    return this.prisma.account.findFirst({
      where: { Provider: 'google', ProviderAccountId: googleId },
      include: { role: true },
    });
  }

  findAccountByUsernameRaw(username: string) {
    return this.prisma.account.findFirst({
      where: { Username: username },
    });
  }

  async createAccount(data: {
    Username: string;
    Email: string;
    PasswordHash: string;
    RoleID: string;
    Avatar?: string;
    Status?: AccountStatus;
    Provider?: string | null;
    ProviderAccountId?: string | null;
    EmailVerified?: boolean;
    LastLogin?: Date | null;
  }) {
    return this.prisma.account.create({
      data: {
        Username: data.Username,
        Email: data.Email,
        PasswordHash: data.PasswordHash,
        RoleID: data.RoleID,
        Avatar: data.Avatar ?? '',
        Status: data.Status ?? AccountStatus.Active,
        Provider: data.Provider ?? null,
        ProviderAccountId: data.ProviderAccountId ?? null,
        EmailVerified: data.EmailVerified ?? false,
        LastLogin: data.LastLogin ?? null,
      },
      select: {
        AccountID: true,
        Username: true,
        Email: true,
        role: true,
        Status: true,
      },
    });
  }

  updateAccount(
    accountId: string,
    data: Prisma.AccountUpdateInput | Prisma.AccountUncheckedUpdateInput,
  ) {
    return this.prisma.account.update({
      where: { AccountID: accountId },
      data,
      include: { role: true },
    });
  }

  updateAccountLastLogin(accountId: string) {
    return this.prisma.account.update({
      where: { AccountID: accountId },
      data: { LastLogin: new Date() },
      include: { role: true },
    });
  }

  // --- Role ---
  findRoleByName(roleName: string) {
    return this.prisma.role.findFirst({
      where: { RoleName: roleName },
    });
  }

  // --- Customer ---
  findCustomerByAccountId(accountId: string) {
    return this.prisma.customer.findFirst({
      where: { AccountID: accountId },
      select: { CustomerID: true },
    });
  }

  createCustomer(data: {
    AccountID: string;
    FullName: string;
    PhoneNumber: string;
    Address: string;
    DateOfBirth?: Date | null;
    Gender?: Gender | null;
    PreferredPaymentMethod?: PaymentMethod;
  }) {
    return this.prisma.customer.create({
      data: {
        AccountID: data.AccountID,
        FullName: data.FullName,
        PhoneNumber: data.PhoneNumber,
        Address: data.Address,
        DateOfBirth: data.DateOfBirth ?? null,
        Gender: data.Gender ?? null,
        PreferredPaymentMethod: data.PreferredPaymentMethod ?? PaymentMethod.Cash,
      },
      select: {
        CustomerID: true,
        FullName: true,
        PhoneNumber: true,
        Address: true,
        DateOfBirth: true,
        Gender: true,
        PreferredPaymentMethod: true,
        AccountID: true,
      },
    });
  }

  // --- AuthToken ---
  findValidAuthTokenByRefreshToken(refreshToken: string) {
    return this.prisma.authToken.findFirst({
      where: { RefreshToken: refreshToken, IsValid: true },
    });
  }

  findValidAuthToken(accountId: string, refreshToken: string) {
    return this.prisma.authToken.findFirst({
      where: { AccountID: accountId, RefreshToken: refreshToken, IsValid: true },
    });
  }

  createAuthToken(data: {
    AccountID: string;
    RefreshToken: string;
    AccessToken: string;
    CreatedAt: Date;
    ExpiredAt: Date;
  }) {
    return this.prisma.authToken.create({
      data: {
        AccountID: data.AccountID,
        RefreshToken: data.RefreshToken,
        AccessToken: data.AccessToken,
        CreatedAt: data.CreatedAt,
        ExpiredAt: data.ExpiredAt,
        RevokedAt: null,
        IsValid: true,
      },
    });
  }

  updateAuthTokenAccessToken(accountId: string, refreshToken: string, hashedAccessToken: string) {
    return this.prisma.authToken.updateMany({
      where: { AccountID: accountId, RefreshToken: refreshToken, IsValid: true },
      data: { AccessToken: hashedAccessToken },
    });
  }

  revokeAllAuthTokensForAccount(accountId: string) {
    return this.prisma.authToken.updateMany({
      where: { AccountID: accountId, IsValid: true },
      data: { IsValid: false, RevokedAt: new Date() },
    });
  }

  // --- PasswordResetToken ---
  invalidatePasswordResetTokensForAccount(accountId: string) {
    return this.prisma.passwordResetToken.updateMany({
      where: { AccountID: accountId, IsUsed: false },
      data: { IsUsed: true },
    });
  }

  createPasswordResetToken(data: {
    AccountID: string;
    ResetCode: string;
    ExpiresAt: Date;
  }) {
    return this.prisma.passwordResetToken.create({
      data: {
        AccountID: data.AccountID,
        ResetCode: data.ResetCode,
        ExpiresAt: data.ExpiresAt,
        IsUsed: false,
      },
    });
  }

  findValidResetTokenByAccountAndCode(accountId: string, code: string) {
    return this.prisma.passwordResetToken.findFirst({
      where: {
        AccountID: accountId,
        ResetCode: code,
        IsUsed: false,
        ExpiresAt: { gt: new Date() },
      },
    });
  }

  findValidResetTokenById(tokenId: string) {
    return this.prisma.passwordResetToken.findFirst({
      where: {
        TokenID: tokenId,
        IsUsed: false,
        ExpiresAt: { gt: new Date() },
      },
      include: { account: { include: { role: true } } },
    });
  }

  async resetPasswordTx(tokenId: string, accountId: string, passwordHash: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { AccountID: accountId },
        data: { PasswordHash: passwordHash },
      });
      await tx.passwordResetToken.update({
        where: { TokenID: tokenId },
        data: { IsUsed: true },
      });
      await tx.authToken.updateMany({
        where: { AccountID: accountId, IsValid: true },
        data: { IsValid: false, RevokedAt: new Date() },
      });
    });
  }

  async changePasswordTx(accountId: string, passwordHash: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { AccountID: accountId },
        data: { PasswordHash: passwordHash },
      });
      await tx.authToken.updateMany({
        where: { AccountID: accountId, IsValid: true },
        data: { IsValid: false, RevokedAt: new Date() },
      });
    });
  }
}
