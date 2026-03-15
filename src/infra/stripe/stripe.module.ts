import { Global, Module } from '@nestjs/common';
import { StripeService } from '@infra/stripe/stripe.service';

@Global()
@Module({
    providers: [StripeService],
    exports: [StripeService],
})
export class StripeModule {}
