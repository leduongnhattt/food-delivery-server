import { Injectable, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '@infra/prisma/prisma.service';
import { StripeService } from '@infra/stripe/stripe.service';
import type { CreateCheckoutSessionRequestDto } from '@modules/payments/dto';
import { EtaService } from '@modules/shipping/eta.service';
import { DeliveryFeeService } from '@modules/shipping/delivery-fee.service';
import crypto from 'crypto';
import { setKeyJson } from '@infra/redis/redis.service';

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
        private readonly deliveryFee: DeliveryFeeService,
    ) { }

    private get stripe(): Stripe {
        return this.stripeService.getClient();
    }

    private stripeAttemptKey(attemptId: string) {
        return `stripe:attempt:${attemptId}`;
    }

    private stripeAttemptTtlSeconds(): number {
        const raw = process.env.STRIPE_ATTEMPT_TTL_SECONDS;
        const n = raw ? Number(raw) : 60 * 60; // 1 hour
        if (!Number.isFinite(n) || n <= 0) return 60 * 60;
        return Math.floor(n);
    }

    private isAbsoluteHttpUrl(input: unknown): boolean {
        const v = typeof input === 'string' ? input.trim() : '';
        return /^https?:\/\/.+/i.test(v);
    }

    private getDefaultProductImageUrl(): string {
        const fromEnv = process.env.APP_DEFAULT_PRODUCT_IMAGE_URL?.trim();
        if (this.isAbsoluteHttpUrl(fromEnv)) return String(fromEnv).trim();
        // Requested default image for products without a real image.
        return 'https://adstandards.com.au/issues/food-beverage-advertising/';
    }

    private pickStripeProductImages(input: unknown): string[] {
        const candidate = typeof input === 'string' ? input.trim() : '';
        // Stripe requires absolute http(s) URLs. Treat relative placeholders as "no image".
        if (this.isAbsoluteHttpUrl(candidate)) return [candidate];
        return [this.getDefaultProductImageUrl()];
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
     * Create a Stripe Checkout session with line items and optional voucher discount.
     *
     * Note: platform commission is a take-rate deducted from enterprise settlement,
     * not a customer fee, so it MUST NOT be charged as a Stripe line item.
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

        const enterpriseId = cartItems[0]?.menuItem?.restaurantId || null;
        const feeQuote = enterpriseId
            ? await this.deliveryFee.quoteForEnterprise({
                enterpriseId,
                deliveryInfo: {
                    address: deliveryInfo?.address,
                    lat: deliveryInfo?.lat,
                    lng: deliveryInfo?.lng,
                },
            })
            : { deliveryFee: 0 };
        const computedDeliveryFee = feeQuote.deliveryFee;

        const subtotal = cartItems.reduce(
            (sum, item) => sum + Number(item.menuItem.price) * Number(item.quantity ?? 0),
            0,
        );
        // Treat any difference between (subtotal + deliveryFee) and provided dto.total as voucher discount.
        const voucherDiscount = Math.max(0, subtotal + computedDeliveryFee - Number(total));
        const computedTotal = Math.max(0, subtotal + computedDeliveryFee - voucherDiscount);

        const lineItems = this.buildLineItems(cartItems, currency);
        if (computedDeliveryFee > 0) {
            lineItems.push({
                price_data: {
                    currency,
                    product_data: { name: 'Delivery Fee' },
                    unit_amount: Math.round(computedDeliveryFee * 100),
                },
                quantity: 1,
            });
        }
        const discounts = await this.buildVoucherDiscount(
            voucherCode,
            lineItems,
            computedTotal,
            currency,
        );

        // Store attempt only; create Order/Payment only after Stripe confirms payment (paid).
        const attemptId = crypto.randomUUID();
        await setKeyJson(
            this.stripeAttemptKey(attemptId),
            {
                attemptId,
                accountId,
                customerId: customer.CustomerID,
                dto: { ...dto, total: computedTotal },
                enterpriseId,
                /** Persisted on `Order.Metadata.checkout` after payment (admin / receipts). */
                pricing: {
                    subtotal,
                    deliveryFee: computedDeliveryFee,
                    voucherDiscount,
                },
                createdAtIso: new Date().toISOString(),
            },
            this.stripeAttemptTtlSeconds(),
        );

        const session = await this.stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: lineItems,
            success_url: successUrl,
            cancel_url: cancelUrl,
            discounts,
            payment_intent_data: {
                metadata: {
                    accountId,
                    attemptId,
                },
            },
            metadata: {
                accountId,
                attemptId,
                itemCount: cartItems.length.toString(),
                total: computedTotal.toString(),
                phone: deliveryInfo?.phone || '',
                address: deliveryInfo?.address || '',
                voucherCode: voucherCode || '',
            },
            customer_email: customerEmail,
        });

        if (!session.url || !session.id) {
            throw new BadRequestException('Failed to create checkout session');
        }

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
                    images: this.pickStripeProductImages(item.menuItem.image),
                },
                unit_amount: Math.round(item.menuItem.price * 100),
            },
            quantity: item.quantity,
        }));
    }

    private async buildVoucherDiscount(
        voucherCode: string | undefined,
        lineItems: Stripe.Checkout.SessionCreateParams.LineItem[],
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
