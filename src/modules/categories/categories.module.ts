import { Module } from '@nestjs/common';
import { CategoriesController } from '@modules/categories/categories.controller';
import { CategoriesService } from '@modules/categories/categories.service';
import { AuthModule } from '@modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}

