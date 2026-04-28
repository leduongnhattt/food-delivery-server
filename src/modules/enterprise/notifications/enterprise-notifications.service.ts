import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RabbitMqService } from '@infra/rabbitmq/rabbitmq.service';
import type { EnterpriseOrderCreatedPayload } from '@infra/rabbitmq/enterprise-order-created.payload';
import { Prisma } from '@prisma/client';
import { MailService } from '@infra/mail/mail.service';
import {
  buildEnterpriseNewOrderEmailHtml,
  buildEnterpriseNewOrderEmailText,
} from '@infra/templates/enterprise-order-created.templates';

type ListOptions = {
  unreadOnly: boolean;
  cursor?: string;
  limit: number;
};

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function pickOrderIdFromNotificationData(data: unknown): string | null {
  if (!isJsonObject(data)) return null;
  const raw = data['orderId'];
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t ? t : null;
}

@Injectable()
export class EnterpriseNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(EnterpriseNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitMqService,
    private readonly mail: MailService,
  ) {}

  onModuleInit(): void {
    this.rabbit.onEnterpriseOrderCreated((payload) =>
      this.handleEnterpriseOrderCreated(payload),
    );
  }

  private async getEnterpriseIdByAccountId(accountId: string): Promise<string> {
    const enterpriseRow = await this.prisma.enterprise.findFirst({
      where: { AccountID: accountId, DeletedAt: null },
      select: { EnterpriseID: true },
    });
    return enterpriseRow?.EnterpriseID ?? '';
  }

  private clampLimit(raw: unknown, fallback: number, max: number): number {
    const parsedNumber =
      typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
    if (!Number.isFinite(parsedNumber) || parsedNumber <= 0) return fallback;
    return Math.min(max, Math.floor(parsedNumber));
  }

  async list(accountId: string, options: ListOptions) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    if (!enterpriseId) {
      return { success: true, notifications: [], unreadCount: 0, nextCursor: null as string | null };
    }

    const notificationFilter: Prisma.EnterpriseNotificationWhereInput = {
      EnterpriseID: enterpriseId,
      ...(options.unreadOnly ? { ReadAt: null } : {}),
    };

    const [unreadCount, notificationRows] = await Promise.all([
      this.prisma.enterpriseNotification.count({
        where: { EnterpriseID: enterpriseId, ReadAt: null },
      }),
      this.prisma.enterpriseNotification.findMany({
        where: notificationFilter,
        orderBy: { CreatedAt: 'desc' },
        take: options.limit,
        ...(options.cursor
          ? { cursor: { NotificationID: options.cursor }, skip: 1 }
          : {}),
      }),
    ]);

    const orderIds = notificationRows
      .filter((notificationRow) => notificationRow.Type === 'ORDER_CREATED')
      .map((notificationRow) =>
        pickOrderIdFromNotificationData(notificationRow.Data),
      )
      .filter((x): x is string => !!x);
    const uniqueOrderIds = Array.from(new Set(orderIds));
    const ordersById = uniqueOrderIds.length
      ? new Map(
          (
            await this.prisma.order.findMany({
              where: { OrderID: { in: uniqueOrderIds } },
              select: {
                OrderID: true,
                TotalAmount: true,
                customer: { select: { FullName: true, account: { select: { Username: true } } } },
                orderDetails: {
                  take: 3,
                  select: { Quantity: true, food: { select: { DishName: true } } },
                },
              },
            })
          ).map((orderRow) => [orderRow.OrderID, orderRow] as const),
        )
      : new Map();

    const notifications = notificationRows.map((notificationRow) => {
      // Never display raw IDs in notification text.
      if (notificationRow.Type === 'ORDER_CREATED') {
        const orderId = pickOrderIdFromNotificationData(notificationRow.Data);
        const order = orderId ? ordersById.get(orderId) : undefined;
        const customerDisplayName =
          order?.customer?.FullName?.trim() ||
          order?.customer?.account?.Username?.trim() ||
          null;
        const totalAmountUsd =
          order?.TotalAmount != null ? Number(order.TotalAmount) : null;
        const itemsPreviewText = (order?.orderDetails ?? [])
          .map((detailLine) => `${detailLine.Quantity}× ${detailLine.food.DishName}`)
          .filter(Boolean)
          .join(', ');
        const bodySegments: string[] = [];
        if (customerDisplayName) bodySegments.push(`From ${customerDisplayName}`);
        if (itemsPreviewText) bodySegments.push(itemsPreviewText);
        if (totalAmountUsd != null && Number.isFinite(totalAmountUsd)) {
          bodySegments.push(`Total $${totalAmountUsd.toFixed(2)}`);
        }
        const body = bodySegments.length
          ? bodySegments.join(' • ')
          : 'A customer placed a new order';

        return {
          id: notificationRow.NotificationID,
          type: notificationRow.Type,
          title: 'New order received',
          body,
          data: notificationRow.Data,
          readAt: notificationRow.ReadAt?.toISOString() ?? null,
          createdAt: notificationRow.CreatedAt.toISOString(),
        };
      }

      return {
        id: notificationRow.NotificationID,
        type: notificationRow.Type,
        title: notificationRow.Title,
        body: notificationRow.Body,
        data: notificationRow.Data,
        readAt: notificationRow.ReadAt?.toISOString() ?? null,
        createdAt: notificationRow.CreatedAt.toISOString(),
      };
    });

    const nextCursor =
      notificationRows.length === options.limit
        ? notificationRows[notificationRows.length - 1]?.NotificationID ?? null
        : null;

    return { success: true, notifications, unreadCount, nextCursor };
  }

  async markRead(accountId: string, notificationId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    if (!enterpriseId) return { success: true, updated: 0 };
    const updateResult = await this.prisma.enterpriseNotification.updateMany({
      where: { NotificationID: notificationId, EnterpriseID: enterpriseId, ReadAt: null },
      data: { ReadAt: new Date() },
    });
    return { success: true, updated: updateResult.count };
  }

  async markAllRead(accountId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    if (!enterpriseId) return { success: true, updated: 0 };
    const updateResult = await this.prisma.enterpriseNotification.updateMany({
      where: { EnterpriseID: enterpriseId, ReadAt: null },
      data: { ReadAt: new Date() },
    });
    return { success: true, updated: updateResult.count };
  }

  async delete(accountId: string, notificationId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    if (!enterpriseId) return { success: true, deleted: 0 };
    const deleteResult = await this.prisma.enterpriseNotification.deleteMany({
      where: { NotificationID: notificationId, EnterpriseID: enterpriseId },
    });
    return { success: true, deleted: deleteResult.count };
  }

  async handleEnterpriseOrderCreated(payload: EnterpriseOrderCreatedPayload): Promise<void> {
    try {
      const title = 'New order received';
      // Avoid showing full internal IDs in the notification text.
      const body = payload.customerName
        ? `From ${payload.customerName}`
        : `A customer placed a new order`;

      // Persist (idempotent by EventID unique).
      await this.prisma.enterpriseNotification.create({
        data: {
          EnterpriseID: payload.enterpriseId,
          Type: 'ORDER_CREATED',
          Title: title,
          Body: body,
          Data: { orderId: payload.orderId },
          EventID: payload.eventId,
          CreatedAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
        },
      });

      // Best-effort email notification (optional; depends on SMTP env).
      const enterpriseRow = await this.prisma.enterprise.findUnique({
        where: { EnterpriseID: payload.enterpriseId },
        select: {
          EnterpriseName: true,
          account: { select: { Email: true } },
        },
      });
      const enterpriseEmail = enterpriseRow?.account?.Email;
      if (enterpriseEmail) {
        const appName = process.env.APP_NAME || 'HanalaFood';
        const appUrl = (process.env.APP_URL || '').trim().replace(/\/$/, '');
        const orderUrl = appUrl
          ? `${appUrl}/enterprise/orders/${encodeURIComponent(payload.orderId)}`
          : null;
        const totalAmountUsd =
          typeof payload.totalAmount === 'number' && Number.isFinite(payload.totalAmount)
            ? payload.totalAmount
            : null;
        await this.mail.sendMail({
          to: enterpriseEmail,
          subject: `[${appName}] New order received`,
          html: buildEnterpriseNewOrderEmailHtml({
            appName,
            enterpriseName: enterpriseRow?.EnterpriseName,
            orderId: payload.orderId,
            customerName: payload.customerName ?? null,
            totalAmount: totalAmountUsd,
            orderUrl,
          }),
          text: buildEnterpriseNewOrderEmailText({
            appName,
            enterpriseName: enterpriseRow?.EnterpriseName,
            orderId: payload.orderId,
            customerName: payload.customerName ?? null,
            totalAmount: totalAmountUsd,
            orderUrl,
          }),
        });
      }
    } catch (e) {
      // Idempotency: ignore duplicates.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return;
      }
      this.logger.error('Failed to persist enterprise notification', e);
      throw e;
    }
  }

  parseListQuery(query: { unread?: string; cursor?: string; limit?: string }) {
    const unreadOnly = query.unread === '1' || query.unread === 'true';
    const cursor =
      typeof query.cursor === 'string' && query.cursor.trim()
        ? query.cursor.trim()
        : undefined;
    const limit = this.clampLimit(query.limit, 20, 50);
    return { unreadOnly, cursor, limit };
  }
}

