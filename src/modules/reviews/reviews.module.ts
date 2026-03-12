import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express/multer';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { ReviewsRepository } from '@infra/repositories/reviews.repository';
import { ReviewsController } from '@modules/reviews/reviews.controller';
import { ReviewsService } from '@modules/reviews/reviews.service';

const multer = require('multer');

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    MulterModule.register({ storage: multer.memoryStorage() }),
  ],
  controllers: [ReviewsController],
  providers: [ReviewsRepository, ReviewsService],
})
export class ReviewsModule {}
