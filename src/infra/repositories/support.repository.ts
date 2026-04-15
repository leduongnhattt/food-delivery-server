import { Injectable } from '@nestjs/common';
import { Prisma, SupportCategory, SupportStatus } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

export type SupportTicketRow = {
  MessageID: string;
  AccountID: string;
  Subject: string;
  Description: string | null;
  SentAt: Date;
  Status: SupportStatus;
  ReplyMessage: string | null;
  Category: SupportCategory;
  AssignedAdminID: string | null;
  AssignedAt: Date | null;
  UpdatedAt: Date | null;
  LastActivityAt: Date | null;
};

@Injectable()
export class SupportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    accountId: string;
    subject: string;
    description: string;
    category?: SupportCategory;
  }) {
    return this.prisma.support.create({
      data: {
        AccountID: params.accountId,
        Subject: params.subject,
        Description: params.description,
        Category: params.category ?? SupportCategory.General,
        LastActivityAt: new Date(),
      },
      select: { MessageID: true },
    });
  }

  async addMessage(params: {
    ticketId: string;
    sender: 'User' | 'Admin';
    body: string;
  }) {
    return this.prisma.supportMessage.create({
      data: {
        SupportID: params.ticketId,
        Sender: params.sender,
        Body: params.body,
      },
      select: {
        SupportMessageID: true,
        Sender: true,
        Body: true,
        CreatedAt: true,
      },
    });
  }

  async findByIdForAccount(ticketId: string, accountId: string) {
    return this.prisma.support.findFirst({
      where: { MessageID: ticketId, AccountID: accountId },
      include: {
        account: { select: { Email: true, Username: true } },
        assignedAdmin: {
          select: { AdminID: true, account: { select: { Username: true } } },
        },
        messages: { orderBy: { CreatedAt: 'asc' } },
      },
    });
  }

  async updateForAccount(
    ticketId: string,
    accountId: string,
    data: { subject?: string; description?: string; category?: SupportCategory },
  ) {
    return this.prisma.support.updateMany({
      where: { MessageID: ticketId, AccountID: accountId },
      data: {
        ...(data.subject !== undefined ? { Subject: data.subject } : {}),
        ...(data.description !== undefined ? { Description: data.description } : {}),
        ...(data.category !== undefined ? { Category: data.category } : {}),
        LastActivityAt: new Date(),
      },
    });
  }

  async deleteForAccount(ticketId: string, accountId: string) {
    return this.prisma.support.deleteMany({
      where: { MessageID: ticketId, AccountID: accountId },
    });
  }

  async findManyForAccount(
    accountId: string,
    opts?: { status?: SupportStatus; take?: number },
  ) {
    const where: Prisma.SupportWhereInput = { AccountID: accountId };
    if (opts?.status) {
      where.Status = opts.status;
    }
    return this.prisma.support.findMany({
      where,
      orderBy: { SentAt: 'desc' },
      take: opts?.take ?? 100,
      include: {
        assignedAdmin: {
          select: { account: { select: { Username: true } } },
        },
      },
    });
  }

  async findManyForAdmin(opts: {
    status?: SupportStatus;
    category?: SupportCategory;
    from?: Date;
    to?: Date;
    take?: number;
  }) {
    const where: Prisma.SupportWhereInput = {};
    if (opts.status) {
      where.Status = opts.status;
    }
    if (opts.category) {
      where.Category = opts.category;
    }
    if (opts.from || opts.to) {
      where.SentAt = {
        ...(opts.from ? { gte: opts.from } : {}),
        ...(opts.to ? { lte: opts.to } : {}),
      };
    }
    return this.prisma.support.findMany({
      where,
      orderBy: { SentAt: 'desc' },
      take: opts.take ?? 200,
      include: {
        account: { select: { Email: true, Username: true } },
        assignedAdmin: {
          select: { AdminID: true, account: { select: { Username: true } } },
        },
      },
    });
  }

  async findByIdForAdmin(ticketId: string) {
    return this.prisma.support.findUnique({
      where: { MessageID: ticketId },
      include: {
        account: { select: { Email: true, Username: true } },
        assignedAdmin: {
          select: { AdminID: true, account: { select: { Username: true } } },
        },
        messages: { orderBy: { CreatedAt: 'asc' } },
      },
    });
  }

  async updateClaim(
    ticketId: string,
    adminId: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'already_claimed' }> {
    const existing = await this.prisma.support.findUnique({
      where: { MessageID: ticketId },
    });
    if (!existing) {
      return { ok: false, reason: 'not_found' };
    }
    if (
      existing.AssignedAdminID &&
      existing.AssignedAdminID !== adminId
    ) {
      return { ok: false, reason: 'already_claimed' };
    }
    if (existing.AssignedAdminID === adminId) {
      return { ok: true };
    }
    await this.prisma.support.update({
      where: { MessageID: ticketId },
      data: {
        AssignedAdminID: adminId,
        AssignedAt: new Date(),
        Status: SupportStatus.InProgress,
        LastActivityAt: new Date(),
      },
    });
    return { ok: true };
  }

  async updateReply(
    ticketId: string,
    replyText: string,
    opts?: { statusAfter?: SupportStatus },
  ) {
    return this.prisma.support.update({
      where: { MessageID: ticketId },
      data: {
        ReplyMessage: replyText,
        Status: opts?.statusAfter ?? SupportStatus.InProgress,
        LastActivityAt: new Date(),
      },
      include: {
        account: { select: { Email: true, Username: true } },
      },
    });
  }

  async updateStatus(ticketId: string, status: SupportStatus) {
    return this.prisma.support.update({
      where: { MessageID: ticketId },
      data: {
        Status: status,
        LastActivityAt: new Date(),
      },
    });
  }

  async getAdminIdByAccountId(accountId: string): Promise<string | null> {
    const row = await this.prisma.admin.findUnique({
      where: { AccountID: accountId },
      select: { AdminID: true },
    });
    return row?.AdminID ?? null;
  }

  async getAccountRoleName(accountId: string): Promise<string | null> {
    const row = await this.prisma.account.findUnique({
      where: { AccountID: accountId },
      include: { role: { select: { RoleName: true } } },
    });
    return row?.role?.RoleName ?? null;
  }
}
