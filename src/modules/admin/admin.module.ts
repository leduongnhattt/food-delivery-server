import { Module } from '@nestjs/common';
import { AdminCustomersModule } from './admin-customers/admin-customers.module';
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
import { AdminEnterprisesModule } from './admin-enterprises/admin-enterprises.module';
import { AdminEnterpriseInvitationsModule } from './admin-enterprise-invitations/admin-enterprise-invitations.module';
import { AdminProfileModule } from './admin-profile/admin-profile.module';
import { AdminReviewsModule } from './admin-reviews/admin-reviews.module';
import { AdminSupportModule } from './admin-support/admin-support.module';
import { AdminVouchersModule } from './admin-vouchers/admin-vouchers.module';
import { AdminOrdersModule } from './admin-orders/admin-orders.module';

/**
 * Aggregates admin-only HTTP features. Each subdomain lives in its own Nest module
 * for easier maintenance and scaling.
 */
@Module({
  imports: [
    AdminDashboardModule,
    AdminCustomersModule,
    AdminEnterprisesModule,
    AdminEnterpriseInvitationsModule,
    AdminProfileModule,
    AdminVouchersModule,
    AdminReviewsModule,
    AdminSupportModule,
    AdminOrdersModule,
  ],
})
export class AdminModule {}
