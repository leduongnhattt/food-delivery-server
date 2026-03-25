import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { StripeService } from '@infra/stripe/stripe.service';
import { CommissionSettlementService } from '@modules/payments/commission-settlement/commission-settlement.service';
import { CartService } from '@modules/cart/cart.service';
import type Stripe from 'stripe';

@Injectable()
export class StripeWebhookHandler {
    private readonly logger = new Logger(StripeWebhookHandler.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly stripeService: StripeService,
        private readonly commissionSettlement: CommissionSettlementService,
        private readonly cartService: CartService,
    ) {}

    constructEvent(payload: Buffer, signature: string): Stripe.Event {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) {
            throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
        }
        return this.stripeService
            .getClient()
            .webhooks.constructEvent(payload, signature, secret);
    }

    async handleEvent(event: Stripe.Event): Promise<void> {
        switch (event.type) {
            case 'payment_intent.succeeded':
                await this.handlePaymentIntentSucceeded(
                    event.data.object as Stripe.PaymentIntent,
                );
                break;
            case 'payment_intent.payment_failed':
                await this.handlePaymentIntentFailed(
                    event.data.object as Stripe.PaymentIntent,
                );
                break;
            default:
                this.logger.debug(`Unhandled Stripe event type: ${event.type}`);
        }
    }

    private async handlePaymentIntentSucceeded(
        paymentIntent: Stripe.PaymentIntent,
    ): Promise<void> {
        const paymentIdFromMetadata = (paymentIntent.metadata?.paymentId || '').trim();
        const orderIdFromMetadata = (paymentIntent.metadata?.orderId || '').trim();
        const accountIdFromMetadata = (paymentIntent.metadata?.accountId || '').trim();

        if (!paymentIdFromMetadata || !orderIdFromMetadata) {
            this.logger.warn('Stripe webhook missing paymentId/orderId metadata');
            return;
        }

        const existingPayment = await this.prisma.payment.findUnique({
            where: { PaymentID: paymentIdFromMetadata },
            include: { order: true },
        });

        if (!existingPayment) {
            this.logger.warn(
                `Payment ${paymentIdFromMetadata} not found during webhook success; skip update`,
            );
            return;
        }
        if (existingPayment.OrderID !== orderIdFromMetadata) {
            this.logger.warn(
                `Payment ${paymentIdFromMetadata} does not match order ${orderIdFromMetadata}; skip update`,
            );
            return;
        }
        if (existingPayment.PaymentStatus === 'Completed') {
            return;
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.payment.update({
                where: { PaymentID: existingPayment.PaymentID },
                data: {
                    PaymentStatus: 'Completed',
                    TransactionID: paymentIntent.id,
                    TransactionData: {
                        ...(existingPayment.TransactionData as object),
                        provider: 'STRIPE',
                        status: paymentIntent.status,
                        amount: paymentIntent.amount,
                        currency: paymentIntent.currency,
                        created: paymentIntent.created,
                        metadata: paymentIntent.metadata,
                        latest_charge:
                            typeof paymentIntent.latest_charge === 'string'
                                ? paymentIntent.latest_charge
                                : undefined,
                        webhook_event: 'payment_intent.succeeded',
                    },
                },
            });

            if (existingPayment.order.Status === 'Pending') {
                await tx.order.update({
                    where: { OrderID: existingPayment.OrderID },
                    data: {
                        Status: 'Confirmed',
                        TotalAmount: paymentIntent.amount / 100,
                    },
                });
            }
        });

        await this.commissionSettlement.applyCommissionAndSettlement(
            existingPayment.OrderID,
        );

        if (accountIdFromMetadata) {
            await this.clearCartForAccount(accountIdFromMetadata);
        }
    }

    private async handlePaymentIntentFailed(
        paymentIntent: Stripe.PaymentIntent,
    ): Promise<void> {
        const paymentIdFromMetadata = (paymentIntent.metadata?.paymentId || '').trim();
        const orderIdFromMetadata = (paymentIntent.metadata?.orderId || '').trim();
        if (!paymentIdFromMetadata || !orderIdFromMetadata) {
            this.logger.warn('Stripe webhook missing paymentId/orderId metadata');
            return;
        }

        const existingPayment = await this.prisma.payment.findUnique({
            where: { PaymentID: paymentIdFromMetadata },
            include: { order: true },
        });
        if (!existingPayment) {
            this.logger.warn(
                `Payment ${paymentIdFromMetadata} not found during webhook failure; skip update`,
            );
            return;
        }
        if (existingPayment.OrderID !== orderIdFromMetadata) {
            this.logger.warn(
                `Payment ${paymentIdFromMetadata} does not match order ${orderIdFromMetadata}; skip update`,
            );
            return;
        }
        if (existingPayment.PaymentStatus === 'Failed') {
            return;
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.payment.update({
                where: { PaymentID: existingPayment.PaymentID },
                data: {
                    PaymentStatus: 'Failed',
                    TransactionID: paymentIntent.id,
                    TransactionData: {
                        ...(existingPayment.TransactionData as object),
                        provider: 'STRIPE',
                        status: paymentIntent.status,
                        amount: paymentIntent.amount,
                        currency: paymentIntent.currency,
                        created: paymentIntent.created,
                        metadata: paymentIntent.metadata,
                        last_payment_error: paymentIntent.last_payment_error
                            ? {
                                  code: paymentIntent.last_payment_error.code,
                                  message:
                                      paymentIntent.last_payment_error.message,
                                  type: paymentIntent.last_payment_error.type,
                              }
                            : undefined,
                        webhook_event: 'payment_intent.payment_failed',
                    },
                },
            });

            if (existingPayment.order.Status === 'Pending') {
                await tx.order.update({
                    where: { OrderID: existingPayment.OrderID },
                    data: { Status: 'Cancelled' },
                });
            }
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

        // Also clear any cached cart id mapping by resolving active cart once.
        await this.cartService.resolveActiveCartId({ userId: accountId });
    }
}

