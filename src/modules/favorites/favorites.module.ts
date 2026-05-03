import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { AuthModule } from '@modules/auth/auth.module';
import { FavoritesController } from '@modules/favorites/favorites.controller';
import { FavoritesService } from '@modules/favorites/favorites.service';

@Module({
  imports: [PrismaModule, CustomersModule, AuthModule],
  controllers: [FavoritesController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}

