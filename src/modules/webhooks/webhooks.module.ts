import { Module } from '@nestjs/common';
import { WebhooksController } from '@modules/webhooks/webhooks.controller';
import { StripeWebhookHandler } from '@modules/webhooks/handlers/stripe-webhook.handler';
import { WebhookDispatcherService } from '@modules/webhooks/webhook-dispatcher.service';
import { CartModule } from '@modules/cart/cart.module';
import { CommissionSettlementModule } from '@modules/payments/commission-settlement/commission-settlement.module';
import { PaymentsModule } from '@modules/payments/payments.module';

/**
 * System-level webhooks module.
 * Centralizes inbound webhook endpoints so future business domains can plug in
 * without coupling to a specific feature module (e.g. payments only).
 */
@Module({
    imports: [CartModule, CommissionSettlementModule, PaymentsModule],
    controllers: [WebhooksController],
    providers: [WebhookDispatcherService, StripeWebhookHandler],
    exports: [WebhookDispatcherService],
})
export class WebhooksModule {}

