import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, AccountStatus, EnterpriseInvitationStatus } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { AuthRepository } from '@infra/repositories/auth.repository';
import { AuthPasswordService } from '@modules/auth/password/password.service';
import { MailService } from '@infra/mail/mail.service';
import { SettingsService } from '@modules/settings/settings.service';
import * as crypto from 'crypto';

const INVITE_EXPIRES_DAYS = 7;
const INVITE_TOKEN_BYTES = 32;
const INVITE_TEMPLATE_KEY = 'admin:enterpriseInvitationEmailTemplate';

export type InviteEnterpriseBody = {
  email: string;
  phoneNumber: string;
  enterpriseNameDraft?: string;
};

export type InvitationTemplateValue = {
  subject: string;
  html: string;
  text?: string;
};

function normalizeEmail(v: string): string {
  return String(v || '').trim().toLowerCase();
}

function normalizePhone(v: string): string {
  return String(v || '').trim();
}

function normalizeEnterpriseNameDraft(v: string | undefined): string {
  return String(v || '').trim();
}

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function randomToken(): string {
  return crypto.randomBytes(INVITE_TOKEN_BYTES).toString('hex');
}

function publicAppBaseUrl(): string {
  const base =
    process.env.APP_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000';
  return String(base).replace(/\/$/, '');
}

function buildInviteLink(token: string): string {
  return `${publicAppBaseUrl()}/enterprise/activate?token=${encodeURIComponent(token)}`;
}

function renderPlaceholders(
  template: string,
  params: Record<string, string>,
): string {
  let out = template;
  for (const [k, v] of Object.entries(params)) {
    const re = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g');
    out = out.replace(re, v);
  }
  return out;
}

function defaultInvitationTemplate(): InvitationTemplateValue {
  const appName = process.env.APP_NAME || 'HanalaFood';
  const supportEmail = process.env.SMTP_USER || 'support@example.com';
  return {
    subject: `Welcome to ${appName} Enterprise`,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enterprise invitation - ${appName}</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#ffffff;border-radius:16px;box-shadow:0 2px 10px rgba(0,0,0,.08);padding:28px;">
      <h2 style="margin:0 0 10px 0;font-size:22px;">Welcome to ${appName} Enterprise</h2>
      <p style="margin:0 0 14px 0;color:#4b5563;line-height:1.6;">
        Hi {{enterpriseEmail}}, you have been invited to join ${appName} as an enterprise.
        Click the button below to complete your activation.
      </p>
      <p style="margin:0 0 18px 0;color:#4b5563;line-height:1.6;">
        This invitation link is valid for <b>{{expiresInDays}}</b> days.
      </p>
      <p style="margin:0 0 18px 0;">
        <a href="{{inviteLink}}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">
          Complete Registration
        </a>
      </p>
      <p style="margin:0 0 8px 0;color:#6b7280;font-size:13px;">
        If you can't click the button, copy and paste this link:
      </p>
      <p style="margin:0 0 20px 0;font-size:13px;word-break:break-all;">
        <a href="{{inviteLink}}" style="color:#2563eb;">{{inviteLink}}</a>
      </p>
      <p style="margin:0;color:#6b7280;font-size:12px;">
        Questions? Contact: <a href="mailto:${supportEmail}" style="color:#2563eb;">${supportEmail}</a>
      </p>
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:11px;margin:14px 0 0 0;">
      © ${new Date().getFullYear()} ${appName}
    </p>
  </div>
</body>
</html>`,
    text:
      `Hi {{enterprise_name}},\n\n` +
      `We're excited to invite you to join ${appName} as an enterprise!\n\n` +
      `Click the link below to complete your registration:\n` +
      `{{invite_link}}\n\n` +
      `This invitation link is valid for {{expiresInDays}} days.\n\n` +
      `Benefits of joining ${appName} as an enterprise:\n` +
      `- Low commission rates\n` +
      `- Fast payouts\n` +
      `- Millions of potential customers\n` +
      `- Easy-to-use enterprise dashboard\n\n` +
      `If you have questions, contact us at ${supportEmail}\n`,
  };
}

@Injectable()
export class AdminEnterpriseInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authRepo: AuthRepository,
    private readonly authPassword: AuthPasswordService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  private async getTemplate(): Promise<InvitationTemplateValue> {
    const v = await this.settings.getJson<InvitationTemplateValue>(
      INVITE_TEMPLATE_KEY,
    );
    return v ?? defaultInvitationTemplate();
  }

  async getTemplateForAdmin(): Promise<{ template: InvitationTemplateValue }> {
    const template = await this.getTemplate();
    return { template };
  }

  async updateTemplateForAdmin(body: InvitationTemplateValue): Promise<{ success: true }> {
    const subject = String(body?.subject || '').trim();
    const html = String(body?.html || '').trim();
    const text = body?.text === undefined ? undefined : String(body.text || '');
    if (!subject || !html) {
      throw new BadRequestException('subject and html are required');
    }
    await this.settings.setJson(INVITE_TEMPLATE_KEY, { subject, html, text });
    return { success: true };
  }

  private async generateUniqueUsername(baseEmail: string): Promise<string> {
    const local = baseEmail.split('@')[0] || 'enterprise';
    const safe = local.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24) || 'enterprise';
    for (let i = 0; i < 10; i++) {
      const suffix = crypto.randomBytes(2).toString('hex');
      const candidate = `${safe}_${suffix}`;
      const exists = await this.prisma.account.findFirst({
        where: { Username: candidate },
        select: { AccountID: true },
      });
      if (!exists) return candidate;
    }
    return `${safe}_${Date.now()}`;
  }

  async inviteEnterprise(body: InviteEnterpriseBody) {
    const email = normalizeEmail(body?.email);
    const phoneNumber = normalizePhone(body?.phoneNumber);
    const enterpriseNameDraft = normalizeEnterpriseNameDraft(body?.enterpriseNameDraft);
    if (!email || !phoneNumber) {
      throw new BadRequestException('email and phoneNumber are required');
    }

    const emailUsed = await this.prisma.account.findFirst({
      where: { Email: email },
      select: { AccountID: true },
    });
    if (emailUsed) {
      throw new ConflictException('Email already in use.');
    }
    const phoneUsed = await this.prisma.enterprise.findFirst({
      where: { PhoneNumber: phoneNumber },
      select: { EnterpriseID: true },
    });
    if (phoneUsed) {
      throw new ConflictException('Phone number already in use.');
    }

    const enterpriseRole = await this.authRepo.findRoleByName('Enterprise');
    if (!enterpriseRole) {
      throw new BadRequestException('Enterprise role not found');
    }

    const username = await this.generateUniqueUsername(email);
    const account = await this.authRepo.createAccount({
      Username: username,
      Email: email,
      PasswordHash: '',
      RoleID: enterpriseRole.RoleID,
      Avatar: '',
      Status: AccountStatus.Inactive,
      Provider: 'email',
      EmailVerified: false,
    });

    const token = randomToken();
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await this.prisma.enterpriseInvitation.create({
      data: {
        AccountID: account.AccountID,
        Email: email,
        PhoneNumber: phoneNumber,
        EnterpriseNameDraft: enterpriseNameDraft || null,
        TokenHash: tokenHash,
        ExpiresAt: expiresAt,
      },
      select: {
        InvitationID: true,
        AccountID: true,
        Email: true,
        PhoneNumber: true,
        ExpiresAt: true,
        Status: true,
        CreatedAt: true,
      },
    });

    const template = await this.getTemplate();
    const inviteLink = buildInviteLink(token);
    const appName = process.env.APP_NAME || 'HanalaFood';
    const supportEmail = process.env.SMTP_USER || 'support@example.com';
    const params = {
      appName,
      enterpriseEmail: email,
      enterpriseNameDraft: enterpriseNameDraft || '',
      sellerName: enterpriseNameDraft || '',
      seller_name: enterpriseNameDraft || '',
      enterpriseName: enterpriseNameDraft || '',
      enterprise_name: enterpriseNameDraft || '',
      inviteLink,
      invite_link: inviteLink,
      expiresInDays: String(INVITE_EXPIRES_DAYS),
      supportEmail,
    };
    const subject = renderPlaceholders(template.subject, params);
    const html = renderPlaceholders(template.html, params);
    const text = template.text ? renderPlaceholders(template.text, params) : undefined;

    const sent = await this.mail.sendMail({ to: email, subject, html, text });
    if (!sent) {
      // Best-effort rollback to avoid orphan pending accounts when SMTP fails.
      await this.prisma.$transaction(async (tx) => {
        await tx.enterpriseInvitation.delete({ where: { InvitationID: invitation.InvitationID } });
        await tx.account.delete({ where: { AccountID: account.AccountID } });
      });
      throw new BadRequestException('Failed to send invitation email');
    }

    return { success: true as const, invitation };
  }

  async listInvitations(params: { status?: string; search?: string }) {
    const statusRaw = (params.status || 'all').toLowerCase();
    const status =
      statusRaw === 'pending' ||
      statusRaw === 'accepted' ||
      statusRaw === 'expired' ||
      statusRaw === 'revoked'
        ? statusRaw
        : 'all';
    const q = String(params.search || '').trim();

    const where: Prisma.EnterpriseInvitationWhereInput = {};
    if (status !== 'all') {
      const normalized =
        (statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1)) as EnterpriseInvitationStatus;
      where.Status = normalized;
    }
    if (q) {
      where.OR = [
        { Email: { contains: q } },
        { PhoneNumber: { contains: q } },
      ];
    }
    const items = await this.prisma.enterpriseInvitation.findMany({
      where,
      orderBy: { CreatedAt: 'desc' },
      select: {
        InvitationID: true,
        AccountID: true,
        Email: true,
        PhoneNumber: true,
        EnterpriseNameDraft: true,
        ExpiresAt: true,
        Status: true,
        AcceptedAt: true,
        CreatedAt: true,
      },
    });
    return { items };
  }

  async revokeInvitation(invitationId: string) {
    const row = await this.prisma.enterpriseInvitation.findUnique({
      where: { InvitationID: invitationId },
      select: { InvitationID: true, Status: true },
    });
    if (!row) throw new NotFoundException('Invitation not found');
    if (row.Status !== 'Pending') {
      throw new BadRequestException('Only pending invitations can be revoked');
    }
    await this.prisma.enterpriseInvitation.update({
      where: { InvitationID: invitationId },
      data: { Status: 'Revoked' },
    });
    return { success: true as const };
  }

  async resendInvitation(invitationId: string) {
    const row = await this.prisma.enterpriseInvitation.findUnique({
      where: { InvitationID: invitationId },
      select: {
        InvitationID: true,
        Email: true,
        EnterpriseNameDraft: true,
        ExpiresAt: true,
        Status: true,
      },
    });
    if (!row) throw new NotFoundException('Invitation not found');
    if (row.Status === 'Accepted' || row.Status === 'Revoked') {
      throw new BadRequestException('This invitation cannot be resent');
    }

    const now = new Date();
    const isExpired =
      row.Status === 'Expired' || row.ExpiresAt.getTime() <= now.getTime();

    const token = randomToken();
    const tokenHash = sha256Hex(token);

    const data: Prisma.EnterpriseInvitationUpdateInput = { TokenHash: tokenHash };
    if (isExpired) {
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + INVITE_EXPIRES_DAYS);
      data.ExpiresAt = newExpiresAt;
      data.Status = 'Pending';
    }

    await this.prisma.enterpriseInvitation.update({
      where: { InvitationID: invitationId },
      data,
    });

    const template = await this.getTemplate();
    const inviteLink = buildInviteLink(token);
    const appName = process.env.APP_NAME || 'HanalaFood';
    const supportEmail = process.env.SMTP_USER || 'support@example.com';
    const draft = row.EnterpriseNameDraft?.trim() || '';
    const params = {
      appName,
      enterpriseEmail: row.Email,
      sellerName: draft,
      seller_name: draft,
      enterpriseName: draft,
      enterprise_name: draft,
      inviteLink,
      invite_link: inviteLink,
      expiresInDays: String(INVITE_EXPIRES_DAYS),
      supportEmail,
    };
    const subject = renderPlaceholders(template.subject, params);
    const html = renderPlaceholders(template.html, params);
    const text = template.text ? renderPlaceholders(template.text, params) : undefined;

    const sent = await this.mail.sendMail({
      to: row.Email,
      subject,
      html,
      text,
    });
    if (!sent) {
      throw new BadRequestException('Failed to send invitation email');
    }
    return { success: true as const };
  }

  /**
   * Admin read model for invitation detail page. Activation token is not stored in plain text;
   * `inviteLinkMasked` is a display-only hint (copy still copies this string).
   */
  async getInvitationDetail(invitationId: string) {
    const row = await this.prisma.enterpriseInvitation.findUnique({
      where: { InvitationID: invitationId },
      select: {
        InvitationID: true,
        AccountID: true,
        Email: true,
        PhoneNumber: true,
        EnterpriseNameDraft: true,
        ExpiresAt: true,
        Status: true,
        AcceptedAt: true,
        CreatedAt: true,
        UpdatedAt: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Invitation not found');
    }

    const base = publicAppBaseUrl();
    const inviteLinkMasked = `${base}/enterprise/activate?token=•••••••••••••••••••••••••••••••••`;

    const timeline: Array<{ title: string; at: string; by: string }> = [];
    timeline.push({
      title: 'Invitation sent',
      at: row.CreatedAt.toISOString(),
      by: 'Admin',
    });
    if (row.Status === 'Accepted' && row.AcceptedAt) {
      timeline.push({
        title: 'Invitation accepted',
        at: row.AcceptedAt.toISOString(),
        by: 'Recipient',
      });
    }
    if (row.Status === 'Revoked') {
      timeline.push({
        title: 'Invitation revoked',
        at: (row.UpdatedAt ?? row.CreatedAt).toISOString(),
        by: 'Admin',
      });
    }
    if (row.Status === 'Expired') {
      timeline.push({
        title: 'Invitation expired',
        at: row.ExpiresAt.toISOString(),
        by: 'System',
      });
    }

    const msPerDay = 24 * 60 * 60 * 1000;
    const daysSinceSent = Math.max(
      0,
      Math.floor((Date.now() - row.CreatedAt.getTime()) / msPerDay),
    );

    return {
      invitation: {
        InvitationID: row.InvitationID,
        AccountID: row.AccountID,
        Email: row.Email,
        PhoneNumber: row.PhoneNumber,
        EnterpriseNameDraft: row.EnterpriseNameDraft,
        ExpiresAt: row.ExpiresAt,
        Status: row.Status,
        AcceptedAt: row.AcceptedAt,
        CreatedAt: row.CreatedAt,
      },
      inviteLinkMasked,
      sentByLabel: 'Admin',
      timeline,
      quickStats: {
        emailOpens: 0,
        linkClicks: 0,
        daysSinceSent,
      },
    };
  }
}

