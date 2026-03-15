import { Module } from '@nestjs/common';
import { StripeCheckoutService } from '@modules/payments/stripe/stripe-checkout.service';
import { CheckoutSuccessService } from '@modules/payments/stripe/checkout-success.service';
import { CommissionSettlementModule } from '@modules/payments/commission-settlement/commission-settlement.module';
import { CartModule } from '@modules/cart/cart.module';

/**
 * Stripe payment submodule: checkout session creation and success flow.
 * Add more Stripe-specific pieces (e.g. webhook) here later.
 */
@Module({
    imports: [CommissionSettlementModule, CartModule],
    providers: [StripeCheckoutService, CheckoutSuccessService],
    exports: [StripeCheckoutService, CheckoutSuccessService],
})
export class StripeModule {}
