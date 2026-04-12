import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { AuthPasswordService } from '@modules/auth/password/password.service';
import { AuthEmailService } from '@modules/auth/auth-email.service';
import { AuthRepository } from '@infra/repositories/auth.repository';
import {
  deleteKey,
  getKeyJson,
  redisClient,
  setKeyJson,
} from '@infra/redis/redis.service';
import * as crypto from 'crypto';

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

type RedisOtpPayload = {
  hash: string;
  createdAt: string;
  expiresAt: string;
};

function validateInviteTokenShape(token: string): void {
  const t = String(token || '').trim();
  if (!t) throw new BadRequestException('token is required');
  // hex token (32 bytes -> 64 chars)
  if (!/^[a-f0-9]{64}$/i.test(t)) {
    throw new BadRequestException('Invalid token');
  }
}

/** Fits ACCOUNT.Locale VarChar(10); BCP47-like tags only. */
function normalizeAccountLocale(input?: string | null): string {
  const fallback = (
    process.env.DEFAULT_ACCOUNT_LOCALE || 'vi'
  ).trim();
  const raw =
    input != null && String(input).trim() !== ''
      ? String(input).trim()
      : fallback;
  const cleaned = raw.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 10);
  return cleaned || 'vi';
}

async function allocateUniqueUsername(
  tx: Prisma.TransactionClient,
  desired: string,
  accountId: string,
): Promise<string> {
  const max = 255;
  const base = desired.trim().slice(0, max);
  const isFree = async (u: string) => {
    const row = await tx.account.findFirst({
      where: { Username: u },
      select: { AccountID: true },
    });
    return !row || row.AccountID === accountId;
  };
  if (await isFree(base)) return base;
  const prefixLen = Math.min(base.length, max - 10);
  const prefix = base.slice(0, prefixLen);
  for (let i = 0; i < 10; i++) {
    const suffix = crypto.randomBytes(4).toString('hex');
    const candidate = `${prefix}_${suffix}`.slice(0, max);
    if (await isFree(candidate)) return candidate;
  }
  return `${prefix.slice(0, Math.max(0, max - 14))}_${Date.now()}`.slice(
    0,
    max,
  );
}

/** 1×1 transparent GIF (tracking pixel body). */
const TRACKING_PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

@Injectable()
export class EnterpriseActivationService {
  private readonly logger = new Logger(EnterpriseActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authRepo: AuthRepository,
    private readonly authPassword: AuthPasswordService,
    private readonly authEmail: AuthEmailService,
  ) { }

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

  private async recordEngagement(
    invitationId: string,
    type: 'EmailOpen' | 'LinkClick',
  ): Promise<void> {
    try {
      await this.prisma.enterpriseInvitationEngagementEvent.create({
        data: {
          InvitationID: invitationId,
          Type: type,
        },
      });
    } catch (e) {
      this.logger.warn(
        `recordEngagement ${type} failed: ${(e as Error).message}`,
      );
    }
  }

  async verifyInvite(token: string) {
    const inv = await this.getPendingInvitationOrThrow(token);
    await this.recordEngagement(inv.InvitationID, 'LinkClick');
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

  /**
   * Email tracking pixel: records EmailOpen when the HTML email is displayed and loads the image.
   * Always returns a 1×1 GIF (even if token is invalid) so clients do not show a broken image.
   */
  async trackEmailOpenPixel(token: string | undefined): Promise<Buffer> {
    const raw = String(token || '').trim();
    try {
      validateInviteTokenShape(raw);
      const tokenHash = sha256Hex(raw);
      const row = await this.prisma.enterpriseInvitation.findFirst({
        where: {
          TokenHash: tokenHash,
          Status: 'Pending',
          ExpiresAt: { gt: new Date() },
        },
        select: { InvitationID: true },
      });
      if (row) {
        await this.recordEngagement(row.InvitationID, 'EmailOpen');
      }
    } catch {
      // invalid shape / not found — still return pixel
    }
    return TRACKING_PIXEL_GIF;
  }

  async step1(params: {
    token: string;
    enterpriseName: string;
    password: string;
    locale?: string;
  }) {
    const inv = await this.getPendingInvitationOrThrow(params.token);
    const enterpriseName = String(params.enterpriseName || '').trim();
    const password = String(params.password || '');
    if (!enterpriseName) {
      throw new BadRequestException('enterpriseName is required');
    }
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const locale = normalizeAccountLocale(params.locale);
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
      const username = await allocateUniqueUsername(
        tx,
        enterpriseName,
        inv.AccountID,
      );
      await tx.account.update({
        where: { AccountID: inv.AccountID },
        data: {
          PasswordHash: hash,
          Username: username,
          Locale: locale,
        },
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

    // DEV-only: log OTP to server console for QA/debugging.
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(
        `DEV OTP for ${inv.Email} (AccountID=${inv.AccountID}): ${resetCode}`,
      );
    }

    // Prefer Redis-backed OTP (faster verification, fewer DB reads).
    const otpKey = `otp:enterprise-activate:${inv.AccountID}`;
    const otpSecret = process.env.OTP_SECRET || 'dev-otp-secret';
    const hash = sha256Hex(`${inv.AccountID}:${resetCode}:${otpSecret}`);
    if (redisClient) {
      await setKeyJson(
        otpKey,
        {
          hash,
          createdAt: new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
        } satisfies RedisOtpPayload,
        60,
      );
    }

    await this.authRepo.invalidatePasswordResetTokensForAccount(inv.AccountID);
    await this.authRepo.createPasswordResetToken({
      AccountID: inv.AccountID,
      // Keep DB record for audit, but verification can be Redis-backed.
      ResetCode: redisClient ? 'REDIS' : resetCode,
      ExpiresAt: expiresAt,
    });

    const sent = await this.authEmail.sendEnterpriseActivationOtp(
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

    const otpKey = `otp:enterprise-activate:${inv.AccountID}`;
    const attemptsKey = `otp:enterprise-activate:attempts:${inv.AccountID}`;

    if (redisClient) {
      const attempts = await redisClient.incr(attemptsKey);
      if (attempts === 1) {
        await redisClient.expire(attemptsKey, 60);
      }
      if (attempts > 8) {
        throw new BadRequestException(
          'Too many attempts. Please request a new OTP.',
        );
      }

      const payload = await getKeyJson<RedisOtpPayload>(otpKey);
      if (!payload?.hash) {
        throw new BadRequestException('Invalid or expired OTP');
      }
      const otpSecret = process.env.OTP_SECRET || 'dev-otp-secret';
      const hash = sha256Hex(`${inv.AccountID}:${otp}:${otpSecret}`);
      if (hash !== payload.hash) {
        throw new BadRequestException('Invalid or expired OTP');
      }

      await deleteKey(otpKey);
      await deleteKey(attemptsKey);

      // Mark DB tokens as used for audit without depending on the code.
      await this.prisma.passwordResetToken.updateMany({
        where: {
          AccountID: inv.AccountID,
          IsUsed: false,
          ExpiresAt: { gt: new Date() },
        },
        data: { IsUsed: true },
      });
      await this.prisma.account.update({
        where: { AccountID: inv.AccountID },
        data: { EmailVerified: true },
      });
      return { success: true as const };
    }

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
    await this.prisma.account.update({
      where: { AccountID: inv.AccountID },
      data: { EmailVerified: true },
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
          select: {
            AccountID: true,
            Status: true,
            PasswordHash: true,
            EmailVerified: true,
          },
        });
        if (!acc) throw new NotFoundException('Account not found');
        if (acc.Status !== AccountStatus.Inactive) {
          throw new ForbiddenException('Account is already active');
        }
        if (!acc.PasswordHash) {
          throw new BadRequestException('Password not set');
        }
        if (!acc.EmailVerified) {
          throw new BadRequestException('Email verification (OTP) is required');
        }

        const created = await tx.enterprise.create({
          data: {
            AccountID: inv.AccountID,
            EnterpriseName: name,
            Address: address,
            Latitude: latitude,
            Longitude: longitude,
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
          data: { Status: AccountStatus.Active },
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

