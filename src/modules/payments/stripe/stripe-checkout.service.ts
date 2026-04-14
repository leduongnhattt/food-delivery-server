import { Injectable, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '@infra/prisma/prisma.service';
import { StripeService } from '@infra/stripe/stripe.service';
import type { CreateCheckoutSessionRequestDto } from '@modules/payments/dto';
import { PAYMENT_STATUS } from '@common/constants/order-payment-status.constants';
import { PAYMENT_PROVIDER } from '@common/constants/payment-provider.constants';
import { PAYMENT_METHOD } from '@common/constants/payment-method.constants';
import { EtaService } from '@modules/shipping/eta.service';

/**
 * Handles Stripe Checkout API: session creation, line items, commission fee, and voucher coupons.
 * Uses Stripe client from infra; isolated from order/commission/settlement persistence.
 */
@Injectable()
export class StripeCheckoutService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly stripeService: StripeService,
        private readonly etaService: EtaService,
    ) {}

    private get stripe(): Stripe {
        return this.stripeService.getClient();
    }

    private getDefaultSuccessUrl(): string {
        const base = process.env.APP_URL || 'http://localhost:3000';
        return `${base.replace(/\/$/, '')}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
    }

    private getDefaultCancelUrl(): string {
        const base = process.env.APP_URL || 'http://localhost:3000';
        return `${base.replace(/\/$/, '')}/checkout`;
    }

    /**
     * Retrieve a checkout session by ID (e.g. to validate payment_status).
     */
    async retrieveSession(sessionId: string): Promise<Stripe.Checkout.Session> {
        const session = await this.stripe.checkout.sessions.retrieve(sessionId);
        if (!session) {
            throw new BadRequestException('Invalid session ID');
        }
        return session;
    }

    /**
     * Create a Stripe Checkout session with line items, optional commission fee, and optional voucher discount.
     */
    async createCheckoutSession(
        accountId: string,
        dto: CreateCheckoutSessionRequestDto,
    ): Promise<{ url: string; sessionId: string }> {
        const {
            cartItems,
            deliveryInfo,
            voucherCode,
            total,
            successUrl = this.getDefaultSuccessUrl(),
            cancelUrl = this.getDefaultCancelUrl(),
            currency = 'usd',
        } = dto;

        if (!Array.isArray(cartItems) || cartItems.length === 0) {
            throw new BadRequestException('Cart is empty');
        }

        const customer = await this.prisma.customer.findFirst({
            where: { AccountID: accountId },
            select: { CustomerID: true },
        });
        if (!customer) {
            throw new BadRequestException('Customer not found');
        }

        const customerEmail = await this.getAccountEmail(accountId);
        const lineItems = this.buildLineItems(cartItems, currency);
        const computedCommissionFee = await this.addCommissionLineItem(
            cartItems,
            lineItems,
            currency,
        );
        const discounts = await this.buildVoucherDiscount(
            voucherCode,
            lineItems,
            computedCommissionFee,
            total,
            currency,
        );

        // Create Order + Payment(Pending) BEFORE redirecting to Stripe.
        // This prevents "missed payment" when the user never returns from Stripe.
        const created = await this.prisma.$transaction(async (tx) => {
            const order = await tx.order.create({
                data: {
                    CustomerID: customer.CustomerID,
                    TotalAmount: 0, // finalized from Stripe amount_total after payment
                    DeliveryAddress: deliveryInfo?.address || '',
                    DeliveryNote: '',
                    Status: 'Pending',
                    orderDetails: {
                        create: cartItems.map((item) => ({
                            FoodID: item.menuItem.id,
                            Quantity: item.quantity,
                            SubTotal: item.menuItem.price * item.quantity,
                        })),
                    },
                },
            });

            const payment = await tx.payment.create({
                data: {
                    OrderID: order.OrderID,
                    PaymentMethod: PAYMENT_METHOD.CreditCard,
                    PaymentStatus: PAYMENT_STATUS.Pending,
                    TransactionData: {
                        provider: PAYMENT_PROVIDER.Stripe,
                    },
                },
            });

            return { order, payment };
        });

        const enterpriseId = cartItems[0]?.menuItem?.restaurantId;
        if (enterpriseId) {
          // Best-effort: do not block checkout if ETA provider fails.
          await this.etaService.computeAndPersistForOrder({
            orderId: created.order.OrderID,
            enterpriseId,
            deliveryInfo: {
              address: deliveryInfo?.address || '',
              lat: deliveryInfo?.lat,
              lng: deliveryInfo?.lng,
            },
          }).catch(() => undefined);
        }

        const session = await this.stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: lineItems,
            success_url: successUrl,
            cancel_url: cancelUrl,
            discounts,
            payment_intent_data: {
                metadata: {
                    orderId: created.order.OrderID,
                    paymentId: created.payment.PaymentID,
                    accountId,
                },
            },
            metadata: {
                accountId,
                orderId: created.order.OrderID,
                paymentId: created.payment.PaymentID,
                itemCount: cartItems.length.toString(),
                total: total.toString(),
                phone: deliveryInfo?.phone || '',
                address: deliveryInfo?.address || '',
                voucherCode: voucherCode || '',
                commissionFee: computedCommissionFee.toString(),
            },
            customer_email: customerEmail,
        });

        if (!session.url || !session.id) {
            throw new BadRequestException('Failed to create checkout session');
        }

        await this.prisma.payment.update({
            where: { PaymentID: created.payment.PaymentID },
            data: {
                TransactionData: {
                    ...(created.payment.TransactionData as object),
                    session_id: session.id,
                },
            },
        });

        return { url: session.url, sessionId: session.id };
    }

    private async getAccountEmail(accountId: string): Promise<string | undefined> {
        const account = await this.prisma.account.findUnique({
            where: { AccountID: accountId },
            select: { Email: true },
        });
        return account?.Email ?? undefined;
    }

    private buildLineItems(
        cartItems: CreateCheckoutSessionRequestDto['cartItems'],
        currency: string,
    ): Stripe.Checkout.SessionCreateParams.LineItem[] {
        return cartItems.map((item) => ({
            price_data: {
                currency,
                product_data: {
                    name: item.menuItem.name,
                    description: item.menuItem.restaurantName
                        ? `Restaurant: ${item.menuItem.restaurantName}`
                        : undefined,
                    images: item.menuItem.image ? [item.menuItem.image] : undefined,
                },
                unit_amount: Math.round(item.menuItem.price * 100),
            },
            quantity: item.quantity,
        }));
    }

    private async addCommissionLineItem(
        cartItems: CreateCheckoutSessionRequestDto['cartItems'],
        lineItems: Stripe.Checkout.SessionCreateParams.LineItem[],
        currency: string,
    ): Promise<number> {
        let computedCommissionFee = 0;
        const firstRestaurantId = cartItems[0]?.menuItem?.restaurantId;
        if (firstRestaurantId) {
            const enterprise = await this.prisma.enterprise.findFirst({
                where: {
                    EnterpriseID: firstRestaurantId,
                    DeletedAt: null,
                },
                select: { CommissionRate: true },
            });
            const commissionRate = Number(enterprise?.CommissionRate ?? 0);
            computedCommissionFee = commissionRate;
        }
        if (computedCommissionFee > 0) {
            lineItems.push({
                price_data: {
                    currency,
                    product_data: { name: 'Commission Fee' },
                    unit_amount: Math.round(computedCommissionFee * 100),
                },
                quantity: 1,
            });
        }
        return computedCommissionFee;
    }

    private async buildVoucherDiscount(
        voucherCode: string | undefined,
        lineItems: Stripe.Checkout.SessionCreateParams.LineItem[],
        _computedCommissionFee: number,
        total: number,
        currency: string,
    ): Promise<Stripe.Checkout.SessionCreateParams.Discount[] | undefined> {
        if (!voucherCode) return undefined;
        const totalBeforeDiscount =
            lineItems.reduce((sum, li) => {
                const priceData = li.price_data as
                    | { unit_amount?: number }
                    | undefined;
                const amount = priceData?.unit_amount ?? 0;
                const qty = li.quantity ?? 1;
                return sum + amount * qty;
            }, 0) / 100;
        const absDiscount = Math.max(0, totalBeforeDiscount - total);
        const absDiscountCents = Math.max(0, Math.round(absDiscount * 100));
        if (absDiscountCents <= 0) return undefined;
        const coupon = await this.stripe.coupons.create({
            amount_off: absDiscountCents,
            currency,
            duration: 'once',
            name: `Voucher ${voucherCode}`,
        });
        return [{ coupon: coupon.id }];
    }
}
