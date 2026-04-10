import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { AuthPasswordService } from '@modules/auth/password/password.service';
import { AuthEmailService } from '@modules/auth/auth-email.service';
import { AuthRepository } from '@infra/repositories/auth.repository';
import * as crypto from 'crypto';

const INVITE_TOKEN_BYTES = 32;

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function validate6DigitCode(code: string): void {
  if (
    typeof code !== 'string' ||
    code.length !== 6 ||
    !/^\d{6}$/.test(code)
  ) {
    throw new BadRequestException('Invalid OTP format');
  }
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function validateInviteTokenShape(token: string): void {
  const t = String(token || '').trim();
  if (!t) throw new BadRequestException('token is required');
  // hex token (32 bytes -> 64 chars)
  if (!/^[a-f0-9]{64}$/i.test(t)) {
    throw new BadRequestException('Invalid token');
  }
}

@Injectable()
export class EnterpriseActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authRepo: AuthRepository,
    private readonly authPassword: AuthPasswordService,
    private readonly authEmail: AuthEmailService,
  ) {}

  private async getPendingInvitationOrThrow(token: string) {
    validateInviteTokenShape(token);
    const tokenHash = sha256Hex(token);
    const row = await this.prisma.enterpriseInvitation.findFirst({
      where: {
        TokenHash: tokenHash,
        Status: 'Pending',
        ExpiresAt: { gt: new Date() },
      },
      select: {
        InvitationID: true,
        AccountID: true,
        Email: true,
        PhoneNumber: true,
        EnterpriseNameDraft: true,
        ExpiresAt: true,
      },
    });
    if (!row) throw new NotFoundException('Invitation is invalid or expired');
    return row;
  }

  async verifyInvite(token: string) {
    const inv = await this.getPendingInvitationOrThrow(token);
    return {
      success: true as const,
      invitation: {
        email: inv.Email,
        phoneNumber: inv.PhoneNumber,
        enterpriseName: inv.EnterpriseNameDraft ?? null,
        expiresAt: inv.ExpiresAt,
      },
    };
  }

  async step1(params: { token: string; enterpriseName: string; password: string }) {
    const inv = await this.getPendingInvitationOrThrow(params.token);
    const enterpriseName = String(params.enterpriseName || '').trim();
    const password = String(params.password || '');
    if (!enterpriseName) {
      throw new BadRequestException('enterpriseName is required');
    }
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const hash = await this.authPassword.hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      const acc = await tx.account.findUnique({
        where: { AccountID: inv.AccountID },
        select: { AccountID: true, Status: true },
      });
      if (!acc) throw new NotFoundException('Account not found');
      if (acc.Status !== AccountStatus.Inactive) {
        throw new ForbiddenException('Account is already active');
      }
      await tx.account.update({
        where: { AccountID: inv.AccountID },
        data: { PasswordHash: hash },
      });
      await tx.enterpriseInvitation.update({
        where: { InvitationID: inv.InvitationID },
        data: { EnterpriseNameDraft: enterpriseName },
      });
    });

    return { success: true as const };
  }

  async sendOtp(params: { token: string }) {
    const inv = await this.getPendingInvitationOrThrow(params.token);

    const account = await this.authRepo.findAccountById(inv.AccountID, {
      withRole: true,
    });
    if (!account) throw new NotFoundException('Account not found');
    if (account.role?.RoleName !== 'Enterprise') {
      throw new ForbiddenException('Invalid role');
    }
    if (account.Status !== AccountStatus.Inactive) {
      throw new ForbiddenException('Account is already active');
    }

    const resetCode = generateOtp();
    const expiresAt = new Date(Date.now() + 60 * 1000);
    await this.authRepo.invalidatePasswordResetTokensForAccount(inv.AccountID);
    await this.authRepo.createPasswordResetToken({
      AccountID: inv.AccountID,
      ResetCode: resetCode,
      ExpiresAt: expiresAt,
    });

    const sent = await this.authEmail.sendPasswordResetCode(
      inv.Email,
      resetCode,
      account.Username,
    );
    if (!sent) {
      throw new BadRequestException('Failed to send OTP');
    }
    return { success: true as const };
  }

  async verifyOtp(params: { token: string; otp: string }) {
    const inv = await this.getPendingInvitationOrThrow(params.token);
    const otp = String(params.otp || '').trim();
    validate6DigitCode(otp);

    const tokenRow = await this.authRepo.findValidResetTokenByAccountAndCode(
      inv.AccountID,
      otp,
    );
    if (!tokenRow) {
      throw new BadRequestException('Invalid or expired OTP');
    }
    await this.prisma.passwordResetToken.update({
      where: { TokenID: tokenRow.TokenID },
      data: { IsUsed: true },
    });
    return { success: true as const };
  }

  async step3(params: {
    token: string;
    address: string;
    latitude: number;
    longitude: number;
    openHours: string;
    closeHours: string;
    description?: string;
  }) {
    const inv = await this.getPendingInvitationOrThrow(params.token);
    const address = String(params.address || '').trim();
    const openHours = String(params.openHours || '').trim();
    const closeHours = String(params.closeHours || '').trim();
    const description = params.description === undefined ? undefined : String(params.description || '').trim();
    const latitude = params.latitude;
    const longitude = params.longitude;

    if (!address || !openHours || !closeHours) {
      throw new BadRequestException('Missing required fields');
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('Invalid coordinates');
    }
    if (latitude < -90 || latitude > 90) throw new BadRequestException('Latitude is out of range');
    if (longitude < -180 || longitude > 180) throw new BadRequestException('Longitude is out of range');

    const name = String(inv.EnterpriseNameDraft || '').trim();
    if (!name) {
      throw new BadRequestException('Step 1 is required');
    }

    try {
      const enterprise = await this.prisma.$transaction(async (tx) => {
        const acc = await tx.account.findUnique({
          where: { AccountID: inv.AccountID },
          select: { AccountID: true, Status: true, PasswordHash: true },
        });
        if (!acc) throw new NotFoundException('Account not found');
        if (acc.Status !== AccountStatus.Inactive) {
          throw new ForbiddenException('Account is already active');
        }
        if (!acc.PasswordHash) {
          throw new BadRequestException('Password not set');
        }

        const created = await tx.enterprise.create({
          data: {
            AccountID: inv.AccountID,
            EnterpriseName: name,
            Address: address,
            Latitude: latitude as any,
            Longitude: longitude as any,
            PhoneNumber: inv.PhoneNumber,
            Description: description ?? null,
            OpenHours: openHours,
            CloseHours: closeHours,
            IsActive: true,
          },
          select: {
            EnterpriseID: true,
            EnterpriseName: true,
            AccountID: true,
            PhoneNumber: true,
          },
        });

        await tx.account.update({
          where: { AccountID: inv.AccountID },
          data: { Status: AccountStatus.Active, EmailVerified: true },
        });

        await tx.enterpriseInvitation.update({
          where: { InvitationID: inv.InvitationID },
          data: { Status: 'Accepted', AcceptedAt: new Date() },
        });

        return created;
      });

      return { success: true as const, enterprise };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('Phone number already in use');
      }
      throw err;
    }
  }
}

