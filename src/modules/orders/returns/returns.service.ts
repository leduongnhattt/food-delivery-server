import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, OrderStatus, ReturnRequestedSolution } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { CustomersService } from '@modules/customers/customers.service';

export type ReturnRequestReasonCode =
  | 'missing_items'
  | 'wrong_item'
  | 'quality_issue'
  | 'damaged_spill'
  | 'late_delivery'
  | 'other';

export interface CreateReturnRequestBody {
  items: Array<{ orderDetailId: string; quantity: number }>;
  reasonCode: ReturnRequestReasonCode;
  reasonText?: string | null;
  requestedSolution?: 'RefundOnly' | 'Replace' | 'StoreCredit';
  metadata?: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function toSolutionEnum(input?: unknown): ReturnRequestedSolution {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return ReturnRequestedSolution.RefundOnly;
  if (raw === 'RefundOnly') return ReturnRequestedSolution.RefundOnly;
  if (raw === 'Replace') return ReturnRequestedSolution.Replace;
  if (raw === 'StoreCredit') return ReturnRequestedSolution.StoreCredit;
  return ReturnRequestedSolution.RefundOnly;
}

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
  ) {}

  private assertReturnWindow(deliveredAt: Date | null): void {
    if (!deliveredAt) {
      throw new BadRequestException(
        'DeliveredAt is missing; cannot request return',
      );
    }
    const ms = Date.now() - deliveredAt.getTime();
    const twoHoursMs = 2 * 60 * 60 * 1000;
    if (ms < 0) {
      throw new BadRequestException('Invalid DeliveredAt timestamp');
    }
    if (ms > twoHoursMs) {
      throw new BadRequestException(
        'Return window expired (must be within 2 hours of delivery)',
      );
    }
  }

  private normalizeItems(
    items: unknown,
  ): Array<{ orderDetailId: string; quantity: number }> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('items is required');
    }
    const normalized: Array<{ orderDetailId: string; quantity: number }> = [];
    for (const it of items) {
      if (!isPlainObject(it)) {
        throw new BadRequestException('Invalid items payload');
      }
      const orderDetailId =
        typeof it.orderDetailId === 'string' ? it.orderDetailId.trim() : '';
      const qtyRaw = it['quantity'];
      const quantity =
        typeof qtyRaw === 'number'
          ? qtyRaw
          : typeof qtyRaw === 'string'
            ? Number(qtyRaw)
            : Number.NaN;
      if (!orderDetailId) {
        throw new BadRequestException('orderDetailId is required');
      }
      if (
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isInteger(quantity)
      ) {
        throw new BadRequestException('quantity must be a positive integer');
      }
      normalized.push({ orderDetailId, quantity });
    }
    // Prevent duplicates (same orderDetailId appears twice).
    const dedup = new Map<string, number>();
    for (const it of normalized) {
      dedup.set(
        it.orderDetailId,
        (dedup.get(it.orderDetailId) ?? 0) + it.quantity,
      );
    }
    return Array.from(dedup.entries()).map(([orderDetailId, quantity]) => ({
      orderDetailId,
      quantity,
    }));
  }

  async createReturnRequestForCustomer(
    accountId: string,
    orderId: string,
    body: CreateReturnRequestBody,
  ) {
    if (!orderId?.trim()) {
      throw new BadRequestException('Order id is required');
    }
    const customer = await this.customersService.getByAccountId(accountId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const items = this.normalizeItems(body.items);
    const reasonCode = body.reasonCode;
    if (
      reasonCode !== 'missing_items' &&
      reasonCode !== 'wrong_item' &&
      reasonCode !== 'quality_issue' &&
      reasonCode !== 'damaged_spill' &&
      reasonCode !== 'late_delivery' &&
      reasonCode !== 'other'
    ) {
      throw new BadRequestException(
        `Invalid reasonCode: ${String(reasonCode)}`,
      );
    }
    const reasonText =
      body.reasonText === undefined || body.reasonText === null
        ? null
        : body.reasonText;
    const requestedSolution = toSolutionEnum(body.requestedSolution);
    const metadata = isPlainObject(body.metadata) ? body.metadata : undefined;

    const order = await this.prisma.order.findUnique({
      where: { OrderID: orderId },
      select: {
        OrderID: true,
        CustomerID: true,
        Status: true,
        DeliveredAt: true,
        orderDetails: {
          select: {
            OrderDetailID: true,
            FoodID: true,
            Quantity: true,
            SubTotal: true,
            food: { select: { EnterpriseID: true } },
          },
        },
        returnRequest: { select: { ReturnRequestID: true } },
      },
    });
    if (!order || order.CustomerID !== customer.CustomerID) {
      throw new NotFoundException('Order not found');
    }
    if (order.returnRequest?.ReturnRequestID) {
      throw new ConflictException(
        'A return request already exists for this order',
      );
    }
    if (order.Status !== OrderStatus.Delivered) {
      throw new BadRequestException('Only delivered orders can be returned');
    }
    this.assertReturnWindow(order.DeliveredAt);

    const enterpriseIds = Array.from(
      new Set(
        order.orderDetails.map((d) => d.food?.EnterpriseID).filter(Boolean),
      ),
    );
    if (enterpriseIds.length !== 1) {
      throw new BadRequestException(
        enterpriseIds.length === 0
          ? 'Order has no enterprise items'
          : 'Multi-enterprise orders are not supported for returns',
      );
    }
    const enterpriseId = enterpriseIds[0];

    const detailById = new Map(
      order.orderDetails.map((d) => [d.OrderDetailID, d]),
    );
    const validatedLines = items.map((it) => {
      const d = detailById.get(it.orderDetailId);
      if (!d) {
        throw new BadRequestException(
          `Invalid orderDetailId: ${it.orderDetailId}`,
        );
      }
      if (it.quantity > d.Quantity) {
        throw new BadRequestException(
          `Invalid quantity for orderDetailId ${it.orderDetailId}: max ${d.Quantity}`,
        );
      }
      // Use actual line subtotal / quantity to preserve discounts/pricing at time of order.
      const unit = new Prisma.Decimal(d.SubTotal).div(d.Quantity);
      const lineAmount = unit.mul(it.quantity);
      return {
        orderDetailId: d.OrderDetailID,
        foodId: d.FoodID,
        quantity: it.quantity,
        lineAmount,
      };
    });

    const requestedAmount = validatedLines.reduce(
      (sum, x) => sum.add(x.lineAmount),
      new Prisma.Decimal(0),
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const req = await tx.returnRequest.create({
        data: {
          OrderID: order.OrderID,
          CustomerID: customer.CustomerID,
          EnterpriseID: enterpriseId,
          ReasonCode: reasonCode,
          ReasonText: reasonText || null,
          RequestedSolution: requestedSolution,
          RequestedAmount: requestedAmount,
          Metadata:
            metadata != null ? (metadata as Prisma.InputJsonValue) : undefined,
        },
        select: {
          ReturnRequestID: true,
          OrderID: true,
          Status: true,
          ReasonCode: true,
          ReasonText: true,
          RequestedSolution: true,
          RequestedAmount: true,
          CreatedAt: true,
        },
      });

      await tx.returnRequestItem.createMany({
        data: validatedLines.map((x) => ({
          ReturnRequestID: req.ReturnRequestID,
          OrderDetailID: x.orderDetailId,
          FoodID: x.foodId,
          Quantity: x.quantity,
          LineAmount: x.lineAmount,
        })),
      });

      // Persist a stable pointer from Order -> ReturnRequest for enterprise list UI.
      // refundPending is intentionally NOT set here (only after enterprise approves).
      const currentOrder = await tx.order.findUnique({
        where: { OrderID: order.OrderID },
        select: { OrderID: true, Metadata: true },
      });
      const base: Record<string, unknown> =
        currentOrder?.Metadata && isPlainObject(currentOrder.Metadata)
          ? { ...(currentOrder.Metadata as Record<string, unknown>) }
          : {};
      const orderMetadata = {
        ...base,
        returnRequestId: req.ReturnRequestID,
      } as Prisma.InputJsonValue;
      await tx.order.update({
        where: { OrderID: order.OrderID },
        data: { Metadata: orderMetadata },
      });

      return req;
    });

    return {
      success: true,
      returnRequest: {
        id: created.ReturnRequestID,
        orderId: created.OrderID,
        status: created.Status,
        reasonCode: created.ReasonCode,
        reasonText: created.ReasonText,
        requestedSolution: created.RequestedSolution,
        requestedAmount: Number(created.RequestedAmount),
        requestedAt: created.CreatedAt.toISOString(),
      },
    };
  }

  async getReturnRequestForCustomer(accountId: string, orderId: string) {
    if (!orderId?.trim()) {
      throw new BadRequestException('Order id is required');
    }
    const customer = await this.customersService.getByAccountId(accountId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const order = await this.prisma.order.findUnique({
      where: { OrderID: orderId },
      select: { OrderID: true, CustomerID: true },
    });
    if (!order || order.CustomerID !== customer.CustomerID) {
      throw new NotFoundException('Order not found');
    }

    const req = await this.prisma.returnRequest.findUnique({
      where: { OrderID: orderId },
      select: {
        ReturnRequestID: true,
        OrderID: true,
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
        },
      },
    });

    if (!req) {
      return { success: true, returnRequest: null };
    }

    const meta =
      req.Metadata &&
      typeof req.Metadata === 'object' &&
      !Array.isArray(req.Metadata)
        ? (req.Metadata as Record<string, unknown>)
        : {};
    const enterpriseResponseNote =
      typeof meta['internalNote'] === 'string' ? meta['internalNote'] : null;

    return {
      success: true,
      returnRequest: {
        id: req.ReturnRequestID,
        orderId: req.OrderID,
        status: req.Status,
        reasonCode: req.ReasonCode,
        reasonText: req.ReasonText,
        requestedSolution: req.RequestedSolution,
        requestedAmount: Number(req.RequestedAmount),
        requestedAt: req.CreatedAt.toISOString(),
        updatedAt: (req.UpdatedAt ?? req.CreatedAt).toISOString(),
        enterpriseResponseNote,
        items: req.items.map((it) => ({
          id: it.ReturnRequestItemID,
          orderDetailId: it.OrderDetailID,
          foodId: it.FoodID,
          foodName: it.food.DishName,
          imageUrl: it.food.ImageURL ?? null,
          quantity: it.Quantity,
          lineAmount: Number(it.LineAmount),
        })),
      },
    };
  }
}
