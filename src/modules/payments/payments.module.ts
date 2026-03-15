import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { PaymentsController } from '@modules/payments/payments.controller';
import { PaymentsService } from '@modules/payments/payments.service';
import { StripeModule } from '@modules/payments/stripe/stripe.module';

/**
 * Payments module: facade and HTTP layer only.
 * Payment-method-specific logic lives in submodules (stripe/, future cod/, paypal/).
 */
@Module({
    imports: [AuthModule, StripeModule],
    controllers: [PaymentsController],
    providers: [PaymentsService],
})
export class PaymentsModule {}
