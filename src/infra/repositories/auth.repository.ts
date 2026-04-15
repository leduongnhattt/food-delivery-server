import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, AccountStatus, Gender, PaymentMethod } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

/**
 * Placeholder phone unique per account (real number should be set when the user updates profile).
 * Shared static value (e.g. 00000000000) violates CUSTOMER_PhoneNumber_key for every signup.
 */
export function placeholderPhoneFromAccountId(accountId: string): string {
  const h = createHash('sha256').update(accountId).digest('hex');
  const n = BigInt('0x' + h.slice(0, 16));
  const tenDigits = (n % 9000000000n) + 1000000000n;
  return `0${tenDigits}`;
}

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

  /**
   * Enterprise login gate: Account.Status, Enterprise.DeletedAt (soft delete),
   * latest EnterpriseInvitation.Status (Pending | Accepted | Expired | Revoked).
   */
  findEnterpriseLoginContext(accountId: string) {
    return this.prisma.account.findUnique({
      where: { AccountID: accountId },
      select: {
        Status: true,
        enterprise: {
          select: {
            EnterpriseID: true,
            DeletedAt: true,
          },
        },
        enterpriseInvitations: {
          orderBy: { CreatedAt: 'desc' },
          take: 1,
          select: { Status: true },
        },
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

  /**
   * Creates Account + Customer in one transaction so a failed customer row does not leave an orphan account.
   */
  createAccountWithCustomerProfile(params: {
    Username: string;
    Email: string;
    PasswordHash: string;
    RoleID: string;
    fullName: string;
    address: string;
    preferredPaymentMethod: PaymentMethod;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          Username: params.Username,
          Email: params.Email,
          PasswordHash: params.PasswordHash,
          RoleID: params.RoleID,
          Avatar: '',
          Status: AccountStatus.Active,
          Provider: null,
          ProviderAccountId: null,
          EmailVerified: false,
          LastLogin: null,
        },
        include: { role: true },
      });
      const phone = placeholderPhoneFromAccountId(account.AccountID);
      const customer = await tx.customer.create({
        data: {
          AccountID: account.AccountID,
          FullName: params.fullName,
          PhoneNumber: phone,
          Address: params.address,
          PreferredPaymentMethod: params.preferredPaymentMethod,
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
      return { ...account, customer };
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

  createEnterprise(data: {
    AccountID: string;
    EnterpriseName: string;
    Address: string;
    Latitude: number;
    Longitude: number;
    PhoneNumber: string;
    Description?: string | null;
    OpenHours: string;
    CloseHours: string;
  }) {
    return this.prisma.enterprise.create({
      data: {
        AccountID: data.AccountID,
        EnterpriseName: data.EnterpriseName,
        Address: data.Address,
        Latitude: data.Latitude,
        Longitude: data.Longitude,
        PhoneNumber: data.PhoneNumber,
        Description: data.Description ?? null,
        OpenHours: data.OpenHours,
        CloseHours: data.CloseHours,
        IsActive: true,
      },
      select: {
        EnterpriseID: true,
        EnterpriseName: true,
        Address: true,
        Latitude: true,
        Longitude: true,
        PhoneNumber: true,
        Description: true,
        OpenHours: true,
        CloseHours: true,
        IsActive: true,
        AccountID: true,
      },
    });
  }
}
