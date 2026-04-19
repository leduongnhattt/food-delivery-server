import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { Prisma, ReturnRequestStatus } from '@prisma/client';
import { invalidateEnterpriseOrderCaches } from '@modules/enterprise/orders/enterprise-order-cache.util';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseDateOrNull(raw?: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeSearch(raw?: string): string | null {
  const t = (raw ?? '').trim();
  return t ? t.toLowerCase() : null;
}

const returnsListSelect = {
  ReturnRequestID: true,
  OrderID: true,
  CustomerID: true,
  EnterpriseID: true,
  Status: true,
  ReasonCode: true,
  ReasonText: true,
  RequestedSolution: true,
  RequestedAmount: true,
  Metadata: true,
  CreatedAt: true,
  UpdatedAt: true,
  items: {
    select: {
      ReturnRequestItemID: true,
      OrderDetailID: true,
      FoodID: true,
      Quantity: true,
      LineAmount: true,
      food: { select: { DishName: true, ImageURL: true } },
    },
    orderBy: { CreatedAt: 'asc' as const },
  },
  order: {
    select: {
      OrderDate: true,
      TotalAmount: true,
      Metadata: true,
      customer: {
        select: { FullName: true, account: { select: { Username: true } } },
      },
    },
  },
} as const satisfies Prisma.ReturnRequestSelect;

type ReturnRow = Prisma.ReturnRequestGetPayload<{
  select: typeof returnsListSelect;
}>;

@Injectable()
export class EnterpriseReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getEnterpriseIdByAccountId(accountId: string): Promise<string> {
    const enterprise = await this.prisma.enterprise.findFirst({
      where: { AccountID: accountId, DeletedAt: null },
      select: { EnterpriseID: true },
    });
    if (!enterprise) throw new NotFoundException('Enterprise not found');
    return enterprise.EnterpriseID;
  }

  private mapRow(r: ReturnRow) {
    const orderMeta =
      r.order?.Metadata && isPlainObject(r.order.Metadata)
        ? (r.order.Metadata as Record<string, unknown>)
        : {};
    const cancelReason =
      typeof orderMeta.cancelReason === 'string'
        ? orderMeta.cancelReason
        : null;
    const refundPending = Boolean(orderMeta.refundPending);
    const customerName =
      r.order?.customer?.FullName ||
      r.order?.customer?.account?.Username ||
      'Unknown Customer';

    return {
      id: r.ReturnRequestID,
      orderId: r.OrderID,
      status: r.Status,
      reasonCode: r.ReasonCode,
      reasonText: r.ReasonText,
      requestedSolution: r.RequestedSolution,
      requestedAmount: Number(r.RequestedAmount),
      metadata: r.Metadata ?? null,
      requestedAt: r.CreatedAt.toISOString(),
      updatedAt: (r.UpdatedAt ?? r.CreatedAt).toISOString(),
      customer: { name: customerName },
      order: {
        orderDate: r.order?.OrderDate.toISOString() ?? null,
        totalAmount:
          r.order?.TotalAmount != null ? Number(r.order.TotalAmount) : null,
        cancelReason,
        refundPending,
      },
      items: r.items.map((it) => ({
        id: it.ReturnRequestItemID,
        orderDetailId: it.OrderDetailID,
        foodId: it.FoodID,
        foodName: it.food.DishName,
        imageUrl: it.food.ImageURL ?? null,
        quantity: it.Quantity,
        lineAmount: Number(it.LineAmount),
      })),
    };
  }

  async list(
    accountId: string,
    params?: {
      status?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    },
  ) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const statusRaw = (params?.status ?? '').trim();
    const status = statusRaw ? (statusRaw as ReturnRequestStatus) : undefined;
    if (status && !Object.values(ReturnRequestStatus).includes(status)) {
      throw new BadRequestException(`Invalid status: ${statusRaw}`);
    }

    const start = parseDateOrNull(params?.startDate ?? undefined);
    const end = parseDateOrNull(params?.endDate ?? undefined);
    const q = normalizeSearch(params?.search);

    const where: Prisma.ReturnRequestWhereInput = {
      EnterpriseID: enterpriseId,
      ...(status ? { Status: status } : {}),
      ...(start || end
        ? {
            CreatedAt: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { ReturnRequestID: { contains: q } },
              { OrderID: { contains: q } },
            ],
          }
        : {}),
    };

    const [rows, totalCount] = await Promise.all([
      this.prisma.returnRequest.findMany({
        where,
        select: returnsListSelect,
        orderBy: { CreatedAt: 'desc' },
      }),
      this.prisma.returnRequest.count({ where }),
    ]);

    return {
      success: true,
      totalCount,
      returns: rows.map((r) => this.mapRow(r)),
    };
  }

  private parseTargetStatus(body: {
    status?: unknown;
  }): 'Approved' | 'Rejected' {
    const raw = body?.status;
    if (typeof raw !== 'string') {
      throw new BadRequestException('status is required');
    }
    const v = raw.trim();
    if (v !== 'Approved' && v !== 'Rejected') {
      throw new BadRequestException(`Invalid status: ${raw}`);
    }
    return v;
  }

  async updateStatus(
    accountId: string,
    returnRequestId: string,
    body: { status?: unknown; internalNote?: unknown },
  ) {
    if (!returnRequestId?.trim()) {
      throw new BadRequestException('Return request id is required');
    }
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const target = this.parseTargetStatus(body);
    const rawNote = body?.internalNote;
    const internalNote =
      rawNote == null
        ? null
        : typeof rawNote === 'string'
          ? rawNote.trim() || null
          : typeof rawNote === 'number' ||
              typeof rawNote === 'boolean' ||
              typeof rawNote === 'bigint'
            ? String(rawNote)
            : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const req = await tx.returnRequest.findFirst({
        where: { ReturnRequestID: returnRequestId, EnterpriseID: enterpriseId },
        select: {
          ReturnRequestID: true,
          OrderID: true,
          Status: true,
          Metadata: true,
        },
      });
      if (!req) {
        throw new NotFoundException('Return request not found');
      }
      if (req.Status !== ReturnRequestStatus.PendingReview) {
        throw new ConflictException(
          `Cannot transition from ${req.Status} to ${target}`,
        );
      }

      const nextStatus =
        target === 'Approved'
          ? ReturnRequestStatus.Approved
          : ReturnRequestStatus.Rejected;

      const baseMeta = isPlainObject(req.Metadata)
        ? (req.Metadata as Record<string, unknown>)
        : {};
      const nextMeta = {
        ...baseMeta,
        ...(internalNote ? { internalNote } : {}),
      };

      await tx.returnRequest.update({
        where: { ReturnRequestID: req.ReturnRequestID },
        data: { Status: nextStatus, Metadata: nextMeta },
      });

      // Keep Order.Metadata.returnRequestId stable for enterprise list UI.
      // Set refundPending only when approved; clear on rejection.
      const order = await tx.order.findUnique({
        where: { OrderID: req.OrderID },
        select: { OrderID: true, Metadata: true },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      const base =
        order.Metadata && isPlainObject(order.Metadata)
          ? (order.Metadata as Record<string, unknown>)
          : {};
      const orderNext = {
        ...base,
        returnRequestId: req.ReturnRequestID,
        refundPending: nextStatus === ReturnRequestStatus.Approved,
      };
      await tx.order.update({
        where: { OrderID: order.OrderID },
        data: { Metadata: orderNext },
      });

      return {
        id: req.ReturnRequestID,
        status: nextStatus,
        orderId: req.OrderID,
      };
    });

    await Promise.resolve(invalidateEnterpriseOrderCaches(enterpriseId)).catch(
      () => undefined,
    );

    return { success: true, ...result };
  }
}
