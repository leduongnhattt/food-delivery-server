import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupportCategory, SupportStatus } from '@prisma/client';
import { SupportRepository } from '@infra/repositories/support.repository';

const USER_ROLES = new Set(['customer', 'enterprise']);

@Injectable()
export class SupportService {
  constructor(private readonly supportRepo: SupportRepository) {}

  private assertUserRole(role: string | undefined): void {
    const r = (role || '').trim().toLowerCase();
    if (!USER_ROLES.has(r)) {
      throw new ForbiddenException('Support tickets are for customers and businesses only');
    }
  }

  async createTicket(
    accountId: string,
    role: string | undefined,
    body: { subject: string; description: string; category?: string },
  ) {
    this.assertUserRole(role);
    const subject = body.subject?.trim();
    const description = body.description?.trim();
    if (!subject || subject.length < 3) {
      throw new BadRequestException('subject is required (min 3 chars)');
    }
    if (!description || description.length < 5) {
      throw new BadRequestException('description is required (min 5 chars)');
    }
    let category: SupportCategory = SupportCategory.General;
    if (body.category) {
      const c = body.category as keyof typeof SupportCategory;
      if (c in SupportCategory) {
        category = SupportCategory[c] as SupportCategory;
      }
    }
    const created = await this.supportRepo.create({
      accountId,
      subject,
      description,
      category,
    });
    // Store full message history (initial user message).
    await this.supportRepo.addMessage({
      ticketId: created.MessageID,
      sender: 'User',
      body: description,
    });
    return { ticketId: created.MessageID };
  }

  async listMyTickets(accountId: string, role: string | undefined, q?: { status?: string }) {
    this.assertUserRole(role);
    const status = this.parseStatus(q?.status);
    const rows = await this.supportRepo.findManyForAccount(accountId, {
      status,
      take: 100,
    });
    return { tickets: rows.map((t) => this.toTicketSummary(t)) };
  }

  async getMyTicket(
    accountId: string,
    role: string | undefined,
    ticketId: string,
  ) {
    this.assertUserRole(role);
    const row = await this.supportRepo.findByIdForAccount(ticketId, accountId);
    if (!row) {
      throw new NotFoundException('Ticket not found');
    }
    return { ticket: this.toTicketDetail(row) };
  }

  async updateMyTicket(
    accountId: string,
    role: string | undefined,
    ticketId: string,
    body: { subject?: string; description?: string; category?: string },
  ) {
    this.assertUserRole(role);
    const row = await this.supportRepo.findByIdForAccount(ticketId, accountId);
    if (!row) {
      throw new NotFoundException('Ticket not found');
    }
    if (row.Status !== SupportStatus.Pending) {
      throw new BadRequestException('Only pending tickets can be edited');
    }

    const subject =
      body.subject !== undefined ? body.subject.trim() : undefined;
    const description =
      body.description !== undefined ? body.description.trim() : undefined;
    if (subject !== undefined && subject.length < 3) {
      throw new BadRequestException('subject is required (min 3 chars)');
    }
    if (description !== undefined && description.length < 5) {
      throw new BadRequestException('description is required (min 5 chars)');
    }

    let category: SupportCategory | undefined = undefined;
    if (body.category !== undefined) {
      const c = body.category as keyof typeof SupportCategory;
      if (c in SupportCategory) {
        category = SupportCategory[c] as SupportCategory;
      } else {
        throw new BadRequestException('Invalid category');
      }
    }

    const updated = await this.supportRepo.updateForAccount(ticketId, accountId, {
      subject,
      description,
      category,
    });
    if (updated.count === 0) {
      throw new NotFoundException('Ticket not found');
    }
    return { success: true };
  }

  async deleteMyTicket(
    accountId: string,
    role: string | undefined,
    ticketId: string,
  ) {
    this.assertUserRole(role);
    const deleted = await this.supportRepo.deleteForAccount(ticketId, accountId);
    if (deleted.count === 0) {
      throw new NotFoundException('Ticket not found');
    }
    return { success: true };
  }

  private parseStatus(s?: string): SupportStatus | undefined {
    if (!s) return undefined;
    const lower = s.toLowerCase();
    for (const v of Object.values(SupportStatus) as SupportStatus[]) {
      if (String(v).toLowerCase() === lower) {
        return v;
      }
    }
    return undefined;
  }

  private toTicketSummary(t: {
    MessageID: string;
    Subject: string;
    Status: SupportStatus;
    Category: SupportCategory;
    SentAt: Date;
    ReplyMessage: string | null;
    assignedAdmin: {
      account: { Username: string } | null;
    } | null;
  }) {
    return {
      id: t.MessageID,
      subject: t.Subject,
      status: t.Status,
      category: t.Category,
      sentAt: t.SentAt.toISOString(),
      hasReply: Boolean(t.ReplyMessage),
      assignedTo: t.assignedAdmin?.account?.Username ?? null,
    };
  }

  private toTicketDetail(row: NonNullable<
    Awaited<ReturnType<SupportRepository['findByIdForAccount']>>
  >) {
    return {
      id: row.MessageID,
      subject: row.Subject,
      description: row.Description,
      status: row.Status,
      category: row.Category,
      sentAt: row.SentAt.toISOString(),
      replyMessage: row.ReplyMessage,
      assignedTo: row.assignedAdmin?.account?.Username ?? null,
      updatedAt: row.UpdatedAt?.toISOString() ?? null,
      messages: (row.messages || []).map((m) => ({
        id: m.SupportMessageID,
        sender: m.Sender,
        body: m.Body,
        createdAt: m.CreatedAt.toISOString(),
      })),
    };
  }
}
