import { Injectable } from '@nestjs/common';
import { StripeWebhookHandler } from '@modules/webhooks/handlers/stripe-webhook.handler';

@Injectable()
export class WebhookDispatcherService {
    constructor(private readonly stripeWebhookHandler: StripeWebhookHandler) {}

    async dispatchStripe(rawBody: Buffer, signature: string): Promise<void> {
        const event = this.stripeWebhookHandler.constructEvent(rawBody, signature);
        await this.stripeWebhookHandler.handleEvent(event);
    }
}

