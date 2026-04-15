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
import { PAYMENT_STATUS } from '@common/constants/order-payment-status.constants';
import { PAYMENT_PROVIDER } from '@common/constants/payment-provider.constants';
import { PAYMENT_METHOD } from '@common/constants/payment-method.constants';
import { getKeyJson, setKeyJson } from '@infra/redis/redis.service';
import { EtaService } from '@modules/shipping/eta.service';
import { invalidateEnterpriseOrderCaches } from '@modules/enterprise/orders/enterprise-order-cache.util';

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
        private readonly etaService: EtaService,
    ) {}

    private stripeAttemptKey(attemptId: string) {
        return `stripe:attempt:${attemptId}`;
    }

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
        const attemptId = (metadata.attemptId as string) || '';
        if (!attemptId) throw new BadRequestException('Missing attempt metadata');

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

        const attempt = await getKeyJson<any>(this.stripeAttemptKey(attemptId));
        if (!attempt || attempt.accountId !== accountId) {
            throw new NotFoundException('Payment attempt not found');
        }

        if (attempt.orderId) {
            await this.clearCartForAccount(accountId);
            return { orderId: attempt.orderId, success: true, cartCleared: true };
        }

        const dto = attempt.dto as { cartItems: any[]; deliveryInfo: any; voucherCode?: string; total: number };
        const amountTotal = typeof session.amount_total === 'number' ? session.amount_total : null;

        const createdOrderId = await this.prisma.$transaction(async (tx) => {
            const order = await tx.order.create({
                data: {
                    CustomerID: customer.CustomerID,
                    TotalAmount: amountTotal !== null ? amountTotal / 100 : dto.total,
                    DeliveryAddress: dto.deliveryInfo?.address || '',
                    DeliveryNote: '',
                    Status: 'Pending',
                    Metadata: {
                        provider: PAYMENT_PROVIDER.Stripe,
                        accountId,
                        voucherCode: dto.voucherCode || null,
                        phone: dto.deliveryInfo?.phone || null,
                    },
                    orderDetails: {
                        create: (dto.cartItems || []).map((item) => ({
                            FoodID: item.menuItem.id,
                            Quantity: item.quantity,
                            SubTotal: item.menuItem.price * item.quantity,
                        })),
                    },
                },
                select: { OrderID: true },
            });

            await tx.payment.create({
                data: {
                    OrderID: order.OrderID,
                    PaymentMethod: PAYMENT_METHOD.CreditCard,
                    PaymentStatus: PAYMENT_STATUS.Completed,
                    TransactionID: (session.payment_intent as string) || undefined,
                    TransactionData: {
                        provider: PAYMENT_PROVIDER.Stripe,
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
                        attemptId,
                    },
                },
            });

            return order.OrderID;
        });

        await setKeyJson(this.stripeAttemptKey(attemptId), { ...attempt, orderId: createdOrderId }, 60 * 60);

        const enterpriseId = attempt.enterpriseId as string | null | undefined;
        if (enterpriseId) {
            await this.etaService.computeAndPersistForOrder({
                orderId: createdOrderId,
                enterpriseId,
                deliveryInfo: {
                    address: dto.deliveryInfo?.address || '',
                    lat: dto.deliveryInfo?.lat,
                    lng: dto.deliveryInfo?.lng,
                },
            }).catch(() => undefined);
            await invalidateEnterpriseOrderCaches(enterpriseId).catch(() => undefined);
        }

        await this.commissionSettlement.applyCommissionAndSettlement(createdOrderId);

        await this.clearCartForAccount(accountId);

        return {
            orderId: createdOrderId,
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
        const attemptId = (metadata.attemptId as string) || '';
        if (!attemptId) {
            throw new BadRequestException('Missing attempt metadata');
        }

        const customer = await this.prisma.customer.findFirst({
            where: { AccountID: accountId },
            select: { CustomerID: true },
        });
        if (!customer) {
            throw new NotFoundException('Customer not found');
        }
        const attempt = await getKeyJson<any>(this.stripeAttemptKey(attemptId));
        const orderId = (attempt?.orderId as string) || '';
        if (!orderId) {
            return {
                sessionId,
                stripePaymentStatus: session.payment_status,
                orderId: '',
                orderStatus: '',
                paymentId: '',
                paymentStatus: '',
            };
        }

        const order = await this.prisma.order.findUnique({
            where: { OrderID: orderId },
            select: { OrderID: true, CustomerID: true, Status: true },
        });
        if (!order || order.CustomerID !== customer.CustomerID) {
            throw new NotFoundException('Order not found');
        }

        const payment = await this.prisma.payment.findFirst({
            where: { OrderID: orderId },
            select: { PaymentID: true, PaymentStatus: true },
            orderBy: { PaymentDate: 'desc' },
        });

        return {
            sessionId,
            stripePaymentStatus: session.payment_status,
            orderId: order.OrderID,
            orderStatus: String(order.Status),
            paymentId: payment?.PaymentID || '',
            paymentStatus: payment?.PaymentStatus ? String(payment.PaymentStatus) : '',
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
