import { Injectable, BadRequestException } from '@nestjs/common';
import { StripeCheckoutService } from '@modules/payments/stripe/stripe-checkout.service';
import { CheckoutSuccessService } from '@modules/payments/stripe/checkout-success.service';
import type {
    CreateCheckoutSessionRequestDto,
    StoreCartDataRequestDto,
} from '@modules/payments/dto';

export type { CreateCheckoutSessionRequestDto } from '@modules/payments/dto';

/**
 * Facade for payment flows. Delegates to:
 * - Stripe: create session, process success (via StripeModule)
 * - storeCartData: logging-only (legacy parity)
 * Future: COD, PayPal, etc. via their own submodules.
 */
@Injectable()
export class PaymentsService {
    constructor(
        private readonly stripeCheckout: StripeCheckoutService,
        private readonly checkoutSuccess: CheckoutSuccessService,
    ) {}

    async createCheckoutSession(
        accountId: string,
        dto: CreateCheckoutSessionRequestDto,
    ): Promise<{ url: string; sessionId: string }> {
        return this.stripeCheckout.createCheckoutSession(accountId, dto);
    }

    async processCheckoutSuccess(params: {
        accountId: string;
        sessionId: string;
    }) {
        return this.checkoutSuccess.processCheckoutSuccess(params);
    }

    /**
     * Store cart snapshot for debugging/observability (logs only).
     * Mirrors legacy Next.js store-cart-data route.
     */
    storeCartData(params: StoreCartDataRequestDto): { success: true } {
        const { sessionId, cartItems, deliveryInfo, voucherCode, total } = params;

        if (!sessionId) {
            throw new BadRequestException('Session ID is required');
        }
        if (!Array.isArray(cartItems)) {
            throw new BadRequestException('cartItems must be an array');
        }

        console.log('Stored cart data for session:', sessionId, {
            delivery: deliveryInfo,
            voucherCode,
            total,
        });
        console.log('Cart items count:', cartItems.length);

        return { success: true };
    }
}
