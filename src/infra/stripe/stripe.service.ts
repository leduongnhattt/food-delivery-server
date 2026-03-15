import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

/**
 * Provides a configured Stripe client. Single place for API version and env-based key.
 * Use this in modules (e.g. payments) instead of instantiating Stripe directly.
 */
@Injectable()
export class StripeService {
    private readonly client: Stripe;

    constructor() {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        if (!secretKey) {
            throw new Error('STRIPE_SECRET_KEY is not configured');
        }
        this.client = new Stripe(secretKey, {
            apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
        });
    }

    getClient(): Stripe {
        return this.client;
    }
}
