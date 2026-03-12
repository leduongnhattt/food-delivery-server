import { Module } from '@nestjs/common';
import { AppController } from '@src/app.controller';
import { AppService } from '@src/app.service';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { FoodsModule } from '@modules/foods/foods.module';
import { AuthModule } from '@modules/auth/auth.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { ReviewsModule } from '@modules/reviews/reviews.module';

@Module({
  imports: [PrismaModule, FoodsModule, AuthModule, RestaurantsModule, ReviewsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
