import { Module } from '@nestjs/common';
import { EnterpriseAvatarController } from '@modules/enterprise/avatar/enterprise-avatar.controller';
import { EnterpriseCategoryController } from '@modules/enterprise/category/enterprise-category.controller';
import { EnterpriseCacheController } from '@modules/enterprise/cache/enterprise-cache.controller';
import { EnterpriseCategoryService } from '@modules/enterprise/category/enterprise-category.service';
import { AuthModule } from '@modules/auth/auth.module';
import { EnterpriseFoodController } from '@modules/enterprise/food/enterprise-food.controller';
import { EnterpriseFoodService } from '@modules/enterprise/food/enterprise-food.service';
import { EnterpriseDashboardController } from '@modules/enterprise/dashboard/enterprise-dashboard.controller';
import { EnterpriseDashboardService } from '@modules/enterprise/dashboard/enterprise-dashboard.service';
import { EnterpriseCheckDataController } from '@modules/enterprise/check-data/enterprise-check-data.controller';
import { EnterpriseCheckDataService } from '@modules/enterprise/check-data/enterprise-check-data.service';
import { EnterpriseMenuController } from '@modules/enterprise/menu/enterprise-menu.controller';
import { EnterpriseMenuService } from '@modules/enterprise/menu/enterprise-menu.service';
import { EnterpriseFoodImageController } from '@modules/enterprise/upload/enterprise-food-image.controller';
import { EnterpriseProfileController } from '@modules/enterprise/profile/enterprise-profile.controller';
import { EnterpriseProfileService } from '@modules/enterprise/profile/enterprise-profile.service';
import { EnterpriseOrdersController } from '@modules/enterprise/orders/enterprise-orders.controller';
import { EnterpriseOrdersService } from '@modules/enterprise/orders/enterprise-orders.service';
import { EnterpriseVoucherController } from '@modules/enterprise/voucher/enterprise-voucher.controller';
import { EnterpriseVoucherService } from '@modules/enterprise/voucher/enterprise-voucher.service';
import { VouchersModule } from '@modules/vouchers/vouchers.module';
import { EnterpriseLocalUploadController } from '@modules/enterprise/upload/enterprise-local-upload.controller';
import { EnterpriseReviewsController } from '@modules/enterprise/reviews/enterprise-reviews.controller';
import { ReviewsModule } from '@modules/reviews/reviews.module';
import { EnterpriseActivationModule } from '@modules/enterprise/activation/enterprise-activation.module';
import { EnterpriseReturnsController } from '@modules/enterprise/returns/enterprise-returns.controller';
import { EnterpriseReturnsService } from '@modules/enterprise/returns/enterprise-returns.service';

@Module({
  imports: [AuthModule, VouchersModule, ReviewsModule, EnterpriseActivationModule],
  controllers: [
    EnterpriseAvatarController,
    EnterpriseCategoryController,
    EnterpriseCacheController,
    EnterpriseFoodController,
    EnterpriseDashboardController,
    EnterpriseCheckDataController,
    EnterpriseMenuController,
    EnterpriseFoodImageController,
    EnterpriseProfileController,
    EnterpriseOrdersController,
    EnterpriseReturnsController,
    EnterpriseVoucherController,
    EnterpriseLocalUploadController,
    EnterpriseReviewsController,
  ],
  providers: [
    EnterpriseCategoryService,
    EnterpriseFoodService,
    EnterpriseDashboardService,
    EnterpriseCheckDataService,
    EnterpriseMenuService,
    EnterpriseProfileService,
    EnterpriseOrdersService,
    EnterpriseReturnsService,
    EnterpriseVoucherService,
  ],
})
export class EnterpriseModule {}

