import { Module } from '@nestjs/common';
import { EnterpriseAvatarController } from '@modules/enterprise/avatar/enterprise-avatar.controller';
import { EnterpriseCategoryController } from '@modules/enterprise/category/enterprise-category.controller';
import { EnterpriseCacheController } from '@modules/enterprise/cache/enterprise-cache.controller';
import { EnterpriseCategoryService } from '@modules/enterprise/category/enterprise-category.service';

@Module({
  controllers: [
    EnterpriseAvatarController,
    EnterpriseCategoryController,
    EnterpriseCacheController,
  ],
  providers: [EnterpriseCategoryService],
})
export class EnterpriseModule {}

