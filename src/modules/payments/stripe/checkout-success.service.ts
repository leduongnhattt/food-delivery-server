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
const DUPLICATE_ORDER_WINDOW_MS = 5 * 60 * 1000;

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
        const phone = (metadata.phone as string) || '';
        const address = (metadata.address as string) || '';

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

        let cartItems = await this.loadCartItemsByCustomer(accountId);
        if (!cartItems || cartItems.length === 0) {
            cartItems = await this.loadCartItemsByResolvedCart(accountId);
        }
        if (!cartItems || cartItems.length === 0) {
            throw new BadRequestException('No cart items found');
        }

        this.validateCartItems(cartItems);

        const deliveryInfo = { phone, address };
        const subtotal = cartItems.reduce(
            (sum: number, item: CartItemWithFood) => sum + Number(item.food.Price) * item.Quantity,
            0,
        );

        const order = await this.findOrCreateOrder(
            customer.CustomerID,
            deliveryInfo,
            customer.Address ?? '',
            cartItems,
            subtotal,
        );

        await this.ensurePaymentRecord(
            session.payment_intent as string,
            sessionId,
            order.OrderID,
            session,
        );

        await this.commissionSettlement.applyCommissionAndSettlement(order.OrderID);

        await this.clearCartForAccount(accountId);

        return {
            orderId: order.OrderID,
            success: true,
            cartCleared: true,
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

    private async findOrCreateOrder(
        customerId: string,
        deliveryInfo: { phone: string; address: string },
        customerAddress: string,
        cartItems: CartItemWithFood[],
        subtotal: number,
    ) {
        const since = new Date(Date.now() - DUPLICATE_ORDER_WINDOW_MS);
        const existingOrder = await this.prisma.order.findFirst({
            where: {
                CustomerID: customerId,
                TotalAmount: subtotal,
                Status: 'Confirmed',
                OrderDate: { gte: since },
            },
        });

        if (existingOrder) {
            return existingOrder;
        }

        return this.prisma.order.create({
            data: {
                CustomerID: customerId,
                TotalAmount: subtotal,
                DeliveryAddress: deliveryInfo?.address || customerAddress,
                DeliveryNote: '',
                Status: 'Confirmed',
                orderDetails: {
                    create: cartItems.map((item: CartItemWithFood) => ({
                        FoodID: item.FoodID,
                        Quantity: item.Quantity,
                        SubTotal: Number(item.food.Price) * item.Quantity,
                    })),
                },
            },
        });
    }

    private async ensurePaymentRecord(
        paymentId: string,
        sessionId: string,
        orderId: string,
        session: Stripe.Checkout.Session,
    ): Promise<void> {
        const existing = await this.prisma.payment.findFirst({
            where: { PaymentID: paymentId },
        });
        if (existing) return;

        await this.prisma.payment.create({
            data: {
                PaymentID: paymentId,
                OrderID: orderId,
                PaymentMethod: 'CreditCard',
                TransactionID: paymentId,
                PaymentStatus: 'Completed',
                TransactionData: {
                    session_id: sessionId,
                    payment_intent: paymentId,
                    amount_total: session.amount_total ?? undefined,
                    currency: session.currency ?? undefined,
                    customer_email:
                        typeof session.customer_email === 'string'
                            ? session.customer_email
                            : undefined,
                },
            },
        });
    }

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
