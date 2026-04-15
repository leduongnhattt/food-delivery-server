import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express/multer';
import { memoryStorage, type StorageEngine } from 'multer';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { ReviewsRepository } from '@infra/repositories/reviews.repository';
import { SupportModule } from '@modules/support/support.module';
import { ReviewsController } from '@modules/reviews/reviews.controller';
import { ReviewsService } from '@modules/reviews/reviews.service';

// Multer typings are correct here but eslint cannot infer them; explicitly allow this call.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
const reviewsUploadStorage: StorageEngine = memoryStorage();

@Module({
  imports: [
    PrismaModule,
    SupportModule,
    AuthModule,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    MulterModule.register({ storage: reviewsUploadStorage }),
  ],
  controllers: [ReviewsController],
  providers: [ReviewsRepository, ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
