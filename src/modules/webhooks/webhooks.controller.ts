import {
    BadRequestException,
    Controller,
    Headers,
    HttpCode,
    InternalServerErrorException,
    Post,
    Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebhookDispatcherService } from '@modules/webhooks/webhook-dispatcher.service';

@Controller('webhooks')
export class WebhooksController {
    constructor(private readonly dispatcher: WebhookDispatcherService) {}

    @Post('stripe')
    @HttpCode(200)
    async handleStripeWebhook(
        @Req() req: Request & { rawBody?: Buffer },
        @Headers('stripe-signature') signature?: string,
    ): Promise<{ received: true }> {
        if (!signature) {
            throw new BadRequestException('Missing stripe-signature header');
        }
        const rawBody = req.rawBody;
        if (!rawBody || !Buffer.isBuffer(rawBody)) {
            throw new BadRequestException(
                'Raw body is required for Stripe webhook verification',
            );
        }

        try {
            await this.dispatcher.dispatchStripe(rawBody, signature);
            return { received: true };
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Webhook processing failed';
            if (message.toLowerCase().includes('signature')) {
                throw new BadRequestException('Invalid webhook signature');
            }
            throw new InternalServerErrorException(message);
        }
    }
}

