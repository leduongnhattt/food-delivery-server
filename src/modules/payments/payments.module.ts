import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { ExchangeRateModule } from '@infra/exchange-rate/exchange-rate.module';
import { PaymentsController } from '@modules/payments/payments.controller';
import { PaymentsService } from '@modules/payments/payments.service';
import { StripeModule } from '@modules/payments/stripe/stripe.module';
import { VnPayService } from '@modules/payments/vnpay/vnpay.service';

/**
 * Payments module: facade and HTTP layer only.
 * Payment-method-specific logic lives in submodules (stripe/, future cod/, paypal/).
 */
@Module({
    imports: [AuthModule, StripeModule, ExchangeRateModule],
    controllers: [PaymentsController],
    providers: [PaymentsService, VnPayService],
    exports: [VnPayService],
})
export class PaymentsModule {}
