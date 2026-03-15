import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

/**
 * Handles commission calculation and settlement records for an order.
 * Shared across payment methods (Stripe, COD, etc.): updates order CommissionAmount,
 * ensures a settlement period exists for the enterprise, adds the order to the settlement,
 * and recalculates NetPayout.
 */
@Injectable()
export class CommissionSettlementService {
    private readonly defaultCommissionRate = 5.0;

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Apply commission to the order and add it to the enterprise's settlement for the current month.
     * Idempotent: safe to call multiple times for the same order.
     */
    async applyCommissionAndSettlement(orderId: string): Promise<void> {
        const orderWithDetails = await this.prisma.order.findUnique({
            where: { OrderID: orderId },
            include: {
                orderDetails: {
                    include: {
                        food: {
                            include: {
                                enterprise: true,
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
        const commissionRate = enterprise.CommissionRate ?? this.defaultCommissionRate;
        const commissionAmount =
            (Number(orderWithDetails.TotalAmount) * Number(commissionRate)) / 100;

        await this.prisma.order.update({
            where: { OrderID: orderId },
            data: { CommissionAmount: commissionAmount },
        });

        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        let settlement = await this.prisma.settlement.findFirst({
            where: {
                EnterpriseID: enterprise.EnterpriseID,
                PeriodStart: periodStart,
                PeriodEnd: periodEnd,
            },
        });

        if (!settlement) {
            settlement = await this.prisma.settlement.create({
                data: {
                    EnterpriseID: enterprise.EnterpriseID,
                    PeriodStart: periodStart,
                    PeriodEnd: periodEnd,
                    NetPayout: 0,
                    Status: 'Pending',
                },
            });
        }

        const existingSettlementItem = await this.prisma.settlementItem.findFirst({
            where: {
                SettlementID: settlement.SettlementID,
                OrderID: orderId,
            },
        });

        if (!existingSettlementItem) {
            await this.prisma.settlementItem.create({
                data: {
                    SettlementID: settlement.SettlementID,
                    OrderID: orderId,
                    IsCOD: false,
                },
            });
        }

        const totalOrders = await this.prisma.settlementItem.findMany({
            where: { SettlementID: settlement.SettlementID },
            include: { order: true },
        });

        const totalAmount = totalOrders.reduce(
            (sum, item) => sum + Number(item.order.TotalAmount),
            0,
        );
        const totalCommission = totalOrders.reduce(
            (sum, item) => sum + Number(item.order.CommissionAmount ?? 0),
            0,
        );
        const netPayout = totalAmount - totalCommission;

        await this.prisma.settlement.update({
            where: { SettlementID: settlement.SettlementID },
            data: { NetPayout: netPayout },
        });
    }
}
