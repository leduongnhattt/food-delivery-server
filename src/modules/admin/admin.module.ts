import { Module } from '@nestjs/common';
import { AdminCustomersModule } from './admin-customers/admin-customers.module';
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
import { AdminEnterprisesModule } from './admin-enterprises/admin-enterprises.module';
import { AdminProfileModule } from './admin-profile/admin-profile.module';
import { AdminReviewsModule } from './admin-reviews/admin-reviews.module';
import { AdminSupportModule } from './admin-support/admin-support.module';
import { AdminVouchersModule } from './admin-vouchers/admin-vouchers.module';

/**
 * Aggregates admin-only HTTP features. Each subdomain lives in its own Nest module
 * for easier maintenance and scaling.
 */
@Module({
  imports: [
    AdminDashboardModule,
    AdminCustomersModule,
    AdminEnterprisesModule,
    AdminProfileModule,
    AdminVouchersModule,
    AdminReviewsModule,
    AdminSupportModule,
  ],
})
export class AdminModule {}
