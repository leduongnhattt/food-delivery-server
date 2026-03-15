import { Module } from '@nestjs/common';
import { CommissionSettlementService } from '@modules/payments/commission-settlement/commission-settlement.service';

/**
 * Shared commission & settlement logic for all payment methods.
 * Imported by Stripe (and future COD, PayPal, etc.) submodules.
 */
@Module({
    providers: [CommissionSettlementService],
    exports: [CommissionSettlementService],
})
export class CommissionSettlementModule {}
