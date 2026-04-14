import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { AuthModule } from '@modules/auth/auth.module';
import { RestaurantsRepository } from '@infra/repositories/restaurants.repository';
import { RestaurantsController } from '@modules/restaurants/restaurants.controller';
import { RestaurantsService } from '@modules/restaurants/restaurants.service';
import { MapboxModule } from '@infra/mapbox/mapbox.module';

@Module({
  imports: [PrismaModule, AuthModule, MapboxModule],
  controllers: [RestaurantsController],
  providers: [RestaurantsRepository, RestaurantsService],
})
export class RestaurantsModule {}
