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

@Module({
  imports: [AuthModule],
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
  ],
  providers: [
    EnterpriseCategoryService,
    EnterpriseFoodService,
    EnterpriseDashboardService,
    EnterpriseCheckDataService,
    EnterpriseMenuService,
    EnterpriseProfileService,
  ],
})
export class EnterpriseModule {}

