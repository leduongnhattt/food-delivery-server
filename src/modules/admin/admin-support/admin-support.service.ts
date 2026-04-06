import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupportCategory, SupportStatus } from '@prisma/client';
import { SupportRepository } from '@infra/repositories/support.repository';
import { RabbitMqService } from '@infra/rabbitmq/rabbitmq.service';

@Injectable()
export class AdminSupportService {
  constructor(
    private readonly supportRepo: SupportRepository,
    private readonly rabbit: RabbitMqService,
  ) {}

  async listTickets(q?: {
    status?: string;
    category?: string;
    from?: string;
    to?: string;
  }) {
    const status = this.parseStatus(q?.status);
    const category = this.parseCategory(q?.category);
    const { from, to } = this.parseDateRange(q?.from, q?.to);
    const rows = await this.supportRepo.findManyForAdmin({
      status,
      category,
      from,
      to,
      take: 200,
    });
    return {
      tickets: rows.map((t) => ({
        id: t.MessageID,
        subject: t.Subject,
        status: t.Status,
        category: t.Category,
        sentAt: t.SentAt.toISOString(),
        requesterEmail: t.account.Email,
        requesterUsername: t.account.Username,
        assignedTo: t.assignedAdmin?.account?.Username ?? null,
        hasReply: Boolean(t.ReplyMessage),
      })),
    };
  }

  async getTicket(ticketId: string) {
    const row = await this.supportRepo.findByIdForAdmin(ticketId);
    if (!row) {
      throw new NotFoundException('Ticket not found');
    }
    return {
      ticket: {
        id: row.MessageID,
        subject: row.Subject,
        description: row.Description,
        status: row.Status,
        category: row.Category,
        sentAt: row.SentAt.toISOString(),
        replyMessage: row.ReplyMessage,
        requesterEmail: row.account.Email,
        requesterUsername: row.account.Username,
        assignedTo: row.assignedAdmin?.account?.Username ?? null,
        assignedAdminId: row.AssignedAdminID,
        updatedAt: row.UpdatedAt?.toISOString() ?? null,
        messages: (row.messages || []).map((m) => ({
          id: m.SupportMessageID,
          sender: m.Sender,
          body: m.Body,
          createdAt: m.CreatedAt.toISOString(),
        })),
      },
    };
  }

  async claimTicket(adminAccountId: string, ticketId: string) {
    const adminId = await this.supportRepo.getAdminIdByAccountId(adminAccountId);
    if (!adminId) {
      throw new NotFoundException('Admin profile not found');
    }
    const result = await this.supportRepo.updateClaim(ticketId, adminId);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        throw new NotFoundException('Ticket not found');
      }
      throw new ConflictException('Ticket already assigned to another admin');
    }
    return { success: true };
  }

  async setStatus(
    ticketId: string,
    body: { status: string },
  ): Promise<{ success: boolean }> {
    const status = this.parseStatus(body.status);
    if (!status) {
      throw new BadRequestException('Invalid status');
    }
    await this.supportRepo.updateStatus(ticketId, status);
    return { success: true };
  }

  async replyAndNotify(
    adminAccountId: string,
    ticketId: string,
    body: { message: string },
  ) {
    const text = body.message?.trim();
    if (!text || text.length < 1) {
      throw new BadRequestException('message is required');
    }
    const adminId = await this.supportRepo.getAdminIdByAccountId(adminAccountId);
    if (!adminId) {
      throw new NotFoundException('Admin profile not found');
    }
    const ticket = await this.supportRepo.findByIdForAdmin(ticketId);
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    if (
      ticket.AssignedAdminID &&
      ticket.AssignedAdminID !== adminId
    ) {
      throw new ConflictException(
        'Another admin is assigned; claim the ticket first',
      );
    }
    if (!ticket.AssignedAdminID) {
      await this.supportRepo.updateClaim(ticketId, adminId);
    }
    const isFirstReply = !ticket.ReplyMessage;
    const updated = await this.supportRepo.updateReply(ticketId, text, {
      // Requirement: first admin reply resolves the ticket.
      statusAfter: isFirstReply ? SupportStatus.Resolved : ticket.Status,
    });
    await this.supportRepo.addMessage({
      ticketId,
      sender: 'Admin',
      body: text,
    });
    const roleName =
      (await this.supportRepo.getAccountRoleName(ticket.AccountID)) || '';
    this.rabbit.publishAdminReplied({
      ticketId,
      ticketCategory: ticket.Category,
      ticketStatus: updated.Status,
      requesterEmail: updated.account.Email,
      requesterUsername: updated.account.Username,
      ticketSubject: ticket.Subject,
      replyBody: text,
      requesterRole: roleName,
    });
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

  private parseCategory(s?: string): SupportCategory | undefined {
    if (!s) return undefined;
    const lower = s.toLowerCase();
    for (const v of Object.values(SupportCategory) as SupportCategory[]) {
      if (String(v).toLowerCase() === lower) {
        return v;
      }
    }
    return undefined;
  }

  private parseDateOnly(s: string, kind: 'from' | 'to'): Date | null {
    const raw = (s || '').trim();
    if (!raw) return null;
    // Accept YYYY-MM-DD from <input type="date">
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const iso =
        kind === 'from'
          ? `${raw}T00:00:00.000Z`
          : `${raw}T23:59:59.999Z`;
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // Accept full ISO timestamps
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private parseDateRange(from?: string, to?: string): { from?: Date; to?: Date } {
    const f = from ? this.parseDateOnly(from, 'from') : null;
    const t = to ? this.parseDateOnly(to, 'to') : null;
    if (from && !f) {
      throw new BadRequestException('Invalid from date');
    }
    if (to && !t) {
      throw new BadRequestException('Invalid to date');
    }
    if (f && t && f.getTime() > t.getTime()) {
      throw new BadRequestException('from must be <= to');
    }
    return { ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) };
  }
}
