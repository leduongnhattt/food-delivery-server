import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { ReviewsModule } from '@modules/reviews/reviews.module';
import { AdminReviewsController } from './admin-reviews.controller';

@Module({
  imports: [AuthModule, ReviewsModule],
  controllers: [AdminReviewsController],
})
export class AdminReviewsModule {}
