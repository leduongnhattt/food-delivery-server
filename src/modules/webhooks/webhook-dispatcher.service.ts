import { Injectable } from '@nestjs/common';
import { StripeWebhookHandler } from '@modules/webhooks/handlers/stripe-webhook.handler';
import { VnPayService } from '@modules/payments/vnpay/vnpay.service';

@Injectable()
export class WebhookDispatcherService {
    constructor(
        private readonly stripeWebhookHandler: StripeWebhookHandler,
        private readonly vnpay: VnPayService,
    ) {}

    async dispatchStripe(rawBody: Buffer, signature: string): Promise<void> {
        const event = this.stripeWebhookHandler.constructEvent(rawBody, signature);
        await this.stripeWebhookHandler.handleEvent(event);
    }

    async dispatchVnPayIpn(query: Record<string, string | undefined>) {
        return this.vnpay.handleIpn(query);
    }
}

