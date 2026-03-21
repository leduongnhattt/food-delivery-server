import { Module } from '@nestjs/common';
import { AdminCustomersModule } from './admin-customers/admin-customers.module';
import { AdminEnterprisesModule } from './admin-enterprises/admin-enterprises.module';
import { AdminProfileModule } from './admin-profile/admin-profile.module';
import { AdminReviewsModule } from './admin-reviews/admin-reviews.module';
import { AdminVouchersModule } from './admin-vouchers/admin-vouchers.module';

/**
 * Aggregates admin-only HTTP features. Each subdomain lives in its own Nest module
 * for easier maintenance and scaling.
 */
@Module({
  imports: [
    AdminCustomersModule,
    AdminEnterprisesModule,
    AdminProfileModule,
    AdminVouchersModule,
    AdminReviewsModule,
  ],
})
export class AdminModule {}
