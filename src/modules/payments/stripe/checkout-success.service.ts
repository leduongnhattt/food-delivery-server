import {
    Injectable,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { CartService } from '@modules/cart/cart.service';
import { CommissionSettlementService } from '@modules/payments/commission-settlement/commission-settlement.service';
import { StripeCheckoutService } from '@modules/payments/stripe/stripe-checkout.service';
import { ITEM_ORDER_VALUE_LIMIT } from '@shared/constants/order-limit';
import type Stripe from 'stripe';

/** Cart item with food and enterprise (from Prisma findMany include). */
type CartItemWithFood = Prisma.CartItemGetPayload<{
    include: { food: { include: { enterprise: true } } };
}>;

/** Time window to detect duplicate order (same customer, amount, status). */
// const DUPLICATE_ORDER_WINDOW_MS = 5 * 60 * 1000;

/**
 * Orchestrates Stripe "checkout success": validates session, creates order and payment,
 * applies commission/settlement, and clears the cart.
 * Loads cart items via customer account first, then falls back to cart resolution (Redis + DB) used by cart API.
 */
@Injectable()
export class CheckoutSuccessService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cartService: CartService,
        private readonly stripeCheckout: StripeCheckoutService,
        private readonly commissionSettlement: CommissionSettlementService,
    ) {}

    async processCheckoutSuccess(params: {
        accountId: string;
        sessionId: string;
    }): Promise<{ orderId: string; success: boolean; cartCleared: boolean }> {
        const { accountId, sessionId } = params;

        if (!sessionId) {
            throw new BadRequestException('Session ID is required');
        }

        const session = await this.stripeCheckout.retrieveSession(sessionId);
        if (session.payment_status !== 'paid') {
            throw new BadRequestException('Payment not completed');
        }

        const metadata = session.metadata || {};
        const orderId = (metadata.orderId as string) || '';
        const paymentId = (metadata.paymentId as string) || '';
        const phone = (metadata.phone as string) || '';
        const address = (metadata.address as string) || '';
        if (!orderId || !paymentId) {
            throw new BadRequestException('Missing order/payment metadata');
        }

        const customer = await this.prisma.customer.findFirst({
            where: { AccountID: accountId },
            select: {
                CustomerID: true,
                AccountID: true,
                FullName: true,
                PhoneNumber: true,
                Address: true,
            },
        });
        if (!customer) {
            throw new NotFoundException('Customer not found');
        }

        const order = await this.prisma.order.findUnique({
            where: { OrderID: orderId },
            select: { OrderID: true, CustomerID: true, Status: true },
        });
        if (!order || order.CustomerID !== customer.CustomerID) {
            throw new NotFoundException('Order not found');
        }

        const payment = await this.prisma.payment.findUnique({
            where: { PaymentID: paymentId },
            select: {
                PaymentID: true,
                OrderID: true,
                PaymentStatus: true,
                TransactionData: true,
            },
        });
        if (!payment || payment.OrderID !== order.OrderID) {
            throw new NotFoundException('Payment not found');
        }

        if (payment.PaymentStatus !== 'Completed') {
            const amountTotal = typeof session.amount_total === 'number' ? session.amount_total : null;
            await this.prisma.$transaction(async (tx) => {
                await tx.payment.update({
                    where: { PaymentID: payment.PaymentID },
                    data: {
                        PaymentStatus: 'Completed',
                        TransactionID: (session.payment_intent as string) || undefined,
                        TransactionData: {
                            ...(payment.TransactionData as object),
                            provider: 'STRIPE',
                            session_id: sessionId,
                            payment_intent:
                                typeof session.payment_intent === 'string'
                                    ? session.payment_intent
                                    : undefined,
                            amount_total: amountTotal ?? undefined,
                            currency: session.currency ?? undefined,
                            customer_email:
                                typeof session.customer_email === 'string'
                                    ? session.customer_email
                                    : undefined,
                            metadata,
                        },
                    },
                });

                if (order.Status === 'Pending') {
                    await tx.order.update({
                        where: { OrderID: order.OrderID },
                        data: {
                            Status: 'Confirmed',
                            DeliveryAddress: address || undefined,
                            TotalAmount:
                                amountTotal !== null
                                    ? amountTotal / 100
                                    : undefined,
                        },
                    });
                }
            });
        }

        await this.commissionSettlement.applyCommissionAndSettlement(order.OrderID);

        await this.clearCartForAccount(accountId);

        return {
            orderId: order.OrderID,
            success: true,
            cartCleared: true,
        };
    }

    async getStripeSessionStatus(params: {
        accountId: string;
        sessionId: string;
    }): Promise<{
        sessionId: string;
        stripePaymentStatus: string;
        orderId: string;
        orderStatus: string;
        paymentId: string;
        paymentStatus: string;
    }> {
        const { accountId, sessionId } = params;
        if (!sessionId) {
            throw new BadRequestException('Session ID is required');
        }

        const session = await this.stripeCheckout.retrieveSession(sessionId);
        const metadata = session.metadata || {};
        const orderId = (metadata.orderId as string) || '';
        const paymentId = (metadata.paymentId as string) || '';
        if (!orderId || !paymentId) {
            throw new BadRequestException('Missing order/payment metadata');
        }

        const customer = await this.prisma.customer.findFirst({
            where: { AccountID: accountId },
            select: { CustomerID: true },
        });
        if (!customer) {
            throw new NotFoundException('Customer not found');
        }

        const order = await this.prisma.order.findUnique({
            where: { OrderID: orderId },
            select: { OrderID: true, CustomerID: true, Status: true },
        });
        if (!order || order.CustomerID !== customer.CustomerID) {
            throw new NotFoundException('Order not found');
        }

        const payment = await this.prisma.payment.findUnique({
            where: { PaymentID: paymentId },
            select: { PaymentID: true, OrderID: true, PaymentStatus: true },
        });
        if (!payment || payment.OrderID !== order.OrderID) {
            throw new NotFoundException('Payment not found');
        }

        return {
            sessionId,
            stripePaymentStatus: session.payment_status,
            orderId: order.OrderID,
            orderStatus: String(order.Status),
            paymentId: payment.PaymentID,
            paymentStatus: String(payment.PaymentStatus),
        };
    }

    /**
     * Load cart items by customer account (cart linked to customer in DB).
     */
    private async loadCartItemsByCustomer(accountId: string) {
        return this.prisma.cartItem.findMany({
            where: {
                cart: {
                    customer: { AccountID: accountId },
                },
            },
            include: {
                food: {
                    include: { enterprise: true },
                },
            },
        });
    }

    /**
     * Fallback: resolve active cart via CartService (Redis + DB) and load items from DB.
     * Covers case where cart is cached by user but query by customer missed it.
     */
    private async loadCartItemsByResolvedCart(accountId: string) {
        const cartId = await this.cartService.resolveActiveCartId({
            userId: accountId,
        });
        if (!cartId) return [];
        await this.cartService.hydrateRedisFromDb(cartId);
        return this.prisma.cartItem.findMany({
            where: { CartID: cartId },
            include: {
                food: {
                    include: { enterprise: true },
                },
            },
        });
    }

    private validateCartItems(cartItems: CartItemWithFood[]): void {
        for (const item of cartItems) {
            if (!item.food.IsAvailable) {
                throw new BadRequestException(
                    `Item ${item.food.DishName} is currently unavailable`,
                );
            }
            const itemTotal = Number(item.Price) * item.Quantity;
            if (itemTotal > ITEM_ORDER_VALUE_LIMIT) {
                throw new BadRequestException(
                    `Item ${item.food.DishName} exceeds per-item order limit.`,
                );
            }
        }
    }

    // Legacy helpers remain for future use, but Stripe success no longer creates orders/payments.

    private async clearCartForAccount(accountId: string): Promise<void> {
        await this.prisma.cartItem.deleteMany({
            where: {
                cart: {
                    customer: { AccountID: accountId },
                },
            },
        });

        const activeCart = await this.prisma.cart.findFirst({
            where: {
                customer: { AccountID: accountId },
                Status: 'Active',
            },
        });
        if (activeCart) {
            await this.prisma.cart.update({
                where: { CartID: activeCart.CartID },
                data: { Status: 'Abandoned' },
            });
        }
    }
}
