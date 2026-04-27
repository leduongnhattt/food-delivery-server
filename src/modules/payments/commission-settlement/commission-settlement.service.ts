import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { OrderStatus, Prisma, PaymentMethod } from '@prisma/client';

/**
 * Handles commission calculation and settlement records for an order.
 * Shared across payment methods (Stripe, COD, etc.): updates order CommissionAmount,
 * ensures a settlement period exists for the enterprise, adds the order to the settlement,
 * and recalculates NetPayout.
 */
@Injectable()
export class CommissionSettlementService {
    private readonly defaultCommissionRatePercent = 5.0;

    constructor(private readonly prisma: PrismaService) {}

    private async resolveEffectiveGlobalCommissionPercent(
        tx: Prisma.TransactionClient,
        now: Date,
    ): Promise<number | null> {
        const row = await tx.platformCommissionGlobalRule.findFirst({
            where: {
                DeletedAt: null,
                IsActive: true,
                ExpiredAt: null,
                EffectiveFrom: { lte: now },
                OR: [{ EffectiveTo: null }, { EffectiveTo: { gte: now } }],
            },
            orderBy: [{ EffectiveFrom: 'desc' }, { CreatedAt: 'desc' }],
            select: { CommissionPercent: true },
        });
        return row?.CommissionPercent != null ? Number(row.CommissionPercent) : null;
    }

    private async resolveEffectiveCategoryCommissionPercents(
        tx: Prisma.TransactionClient,
        input: { foodCategoryIds: string[]; now: Date },
    ): Promise<Map<string, number>> {
        const ids = [...new Set(input.foodCategoryIds.filter(Boolean))];
        if (ids.length === 0) return new Map();

        // Invariant from jobs/admin: at most one active row per category.
        // We still order defensively and keep the best candidate per category.
        const rows = await tx.categoryCommissionDefault.findMany({
            where: {
                DeletedAt: null,
                IsActive: true,
                ExpiredAt: null,
                FoodCategoryID: { in: ids },
                EffectiveFrom: { lte: input.now },
                OR: [{ EffectiveTo: null }, { EffectiveTo: { gte: input.now } }],
            },
            orderBy: [
                { FoodCategoryID: 'asc' },
                { EffectiveFrom: 'desc' },
                { CreatedAt: 'desc' },
            ],
            select: { FoodCategoryID: true, CommissionPercent: true },
        });

        const map = new Map<string, number>();
        for (const r of rows) {
            if (map.has(r.FoodCategoryID)) continue;
            map.set(r.FoodCategoryID, Number(r.CommissionPercent));
        }
        return map;
    }

    private toMoneyDecimal(amount: number): Prisma.Decimal {
        const safe = Number.isFinite(amount) ? amount : 0;
        // Keep 2 decimals for storage consistency.
        return new Prisma.Decimal(Math.round(safe * 100) / 100);
    }

    private toPercentDecimal(percent: number): Prisma.Decimal {
        const safe = Number.isFinite(percent) ? percent : 0;
        return new Prisma.Decimal(Math.round(safe * 100) / 100);
    }

    /**
     * Apply commission to the order and add it to the enterprise's settlement for the current month.
     * Idempotent: safe to call multiple times for the same order.
     */
    async applyCommissionAndSettlement(orderId: string): Promise<void> {
        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        await this.prisma.$transaction(async (tx) => {
            const orderWithDetails = await tx.order.findUnique({
                where: { OrderID: orderId },
                include: {
                    payments: { orderBy: { PaymentDate: 'desc' } },
                    orderDetails: {
                        include: {
                            food: {
                                select: {
                                    FoodID: true,
                                    FoodCategoryID: true,
                                    enterprise: { select: { EnterpriseID: true, CommissionRate: true } },
                                },
                            },
                        },
                    },
                },
            });

            if (!orderWithDetails || orderWithDetails.orderDetails.length === 0) {
                return;
            }

            const enterprise = orderWithDetails.orderDetails[0].food.enterprise;

            const hasCompletedNonCashPayment = (orderWithDetails.payments ?? []).some(
                (p) =>
                    p.PaymentMethod !== PaymentMethod.Cash &&
                    String(p.PaymentStatus) === 'Completed',
            );
            const isCod = !hasCompletedNonCashPayment;

            const foodCategoryIds = orderWithDetails.orderDetails
                .map((d) => d.food.FoodCategoryID)
                .filter((v): v is string => typeof v === 'string' && v.length > 0);

            const [categoryPercentById, globalPercent] = await Promise.all([
                this.resolveEffectiveCategoryCommissionPercents(tx, { foodCategoryIds, now }),
                this.resolveEffectiveGlobalCommissionPercent(tx, now),
            ]);

            const fallbackEnterprisePercent =
                enterprise.CommissionRate != null
                    ? Number(enterprise.CommissionRate)
                    : this.defaultCommissionRatePercent;

            let orderCommissionAmount = 0;

            for (const detail of orderWithDetails.orderDetails) {
                const lineSubTotal = Number(detail.SubTotal);
                const categoryId = detail.food.FoodCategoryID;
                const appliedPercent =
                    (categoryId ? categoryPercentById.get(categoryId) : undefined) ??
                    globalPercent ??
                    fallbackEnterprisePercent;

                const lineCommission =
                    (Number.isFinite(lineSubTotal) ? lineSubTotal : 0) *
                    (Number.isFinite(appliedPercent) ? appliedPercent : 0) /
                    100;

                orderCommissionAmount += lineCommission;

                await tx.orderDetail.update({
                    where: { OrderDetailID: detail.OrderDetailID },
                    data: {
                        AppliedCommissionPercent: this.toPercentDecimal(appliedPercent),
                        CommissionLineAmount: this.toMoneyDecimal(lineCommission),
                    },
                });
            }

            await tx.order.update({
                where: { OrderID: orderId },
                data: { CommissionAmount: this.toMoneyDecimal(orderCommissionAmount) },
            });

            const isPayoutEligible =
                orderWithDetails.Status === OrderStatus.Delivered ||
                orderWithDetails.Status === OrderStatus.Completed;

            // Commission is computed early for UI/estimation, but payout (settlement NetPayout)
            // is only affected once the order is delivered/completed.
            if (!isPayoutEligible) {
                return;
            }

            let settlement = await tx.settlement.findFirst({
                where: {
                    EnterpriseID: enterprise.EnterpriseID,
                    PeriodStart: periodStart,
                    PeriodEnd: periodEnd,
                },
                select: { SettlementID: true },
            });

            if (!settlement) {
                settlement = await tx.settlement.create({
                    data: {
                        EnterpriseID: enterprise.EnterpriseID,
                        PeriodStart: periodStart,
                        PeriodEnd: periodEnd,
                        NetPayout: new Prisma.Decimal(0),
                        Status: 'Pending',
                    },
                    select: { SettlementID: true },
                });
            }

            const existingSettlementItem = await tx.settlementItem.findFirst({
                where: {
                    SettlementID: settlement.SettlementID,
                    OrderID: orderId,
                },
                select: { SettlementItemID: true, IsCOD: true },
            });

            if (!existingSettlementItem) {
                await tx.settlementItem.create({
                    data: {
                        SettlementID: settlement.SettlementID,
                        OrderID: orderId,
                        IsCOD: isCod,
                    },
                });
            } else if (existingSettlementItem.IsCOD !== isCod) {
                await tx.settlementItem.update({
                    where: { SettlementItemID: existingSettlementItem.SettlementItemID },
                    data: { IsCOD: isCod },
                });
            }

            const settlementItems = await tx.settlementItem.findMany({
                where: { SettlementID: settlement.SettlementID },
                include: {
                    order: {
                        include: {
                            orderDetails: { select: { SubTotal: true } },
                        },
                    },
                },
            });

            const pickDeliveryMethod = (meta: unknown): string | null => {
                if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
                const obj = meta as Record<string, unknown>;
                const v = obj['deliveryMethod'];
                const s = typeof v === 'string' ? v.trim() : '';
                return s ? s : null;
            };

            const pickDeliveryFee = (meta: unknown): number | null => {
                if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
                const obj = meta as Record<string, unknown>;
                const v = obj['deliveryFee'];
                const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
                return Number.isFinite(n) && n >= 0 ? n : null;
            };

            // NetPayout policy:
            // - Online orders: +grossMerchandise - commission
            //   - If deliveryMethod=SelfDelivery: grossMerchandise also includes delivery fee (paid by buyer)
            // - COD orders: 0 - commission (platform does not hold COD cash)
            let netPayout = 0;
            for (const item of settlementItems) {
                const commission = Number(item.order.CommissionAmount ?? 0);
                const merchandise = item.order.orderDetails.reduce(
                    (sum, d) => sum + Number(d.SubTotal),
                    0,
                );

                const deliveryMethod = pickDeliveryMethod(item.order.Metadata);
                const deliveryMethodNorm = (deliveryMethod ?? '').trim().toLowerCase();
                const deliveryFeeFromMeta = pickDeliveryFee(item.order.Metadata);
                const deliveryFeeFallback = Math.max(
                    0,
                    Number(item.order.TotalAmount ?? 0) - merchandise,
                );
                const deliveryFee =
                    deliveryFeeFromMeta ??
                    (Number.isFinite(deliveryFeeFallback) ? deliveryFeeFallback : 0);

                const assumeSelfDelivery = deliveryMethodNorm === '' || deliveryMethodNorm === 'selfdelivery';
                const grossMerchandise = item.IsCOD
                    ? 0
                    : merchandise + (assumeSelfDelivery ? deliveryFee : 0);
                netPayout += grossMerchandise - (Number.isFinite(commission) ? commission : 0);
            }

            await tx.settlement.update({
                where: { SettlementID: settlement.SettlementID },
                data: { NetPayout: this.toMoneyDecimal(netPayout) },
            });
        });
    }
}
