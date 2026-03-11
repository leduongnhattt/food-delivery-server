import { Module } from '@nestjs/common';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { FoodsRepository } from '@infra/repositories/foods.repository';
import { FoodsController } from '@modules/foods/foods.controller';
import { FoodsService } from '@modules/foods/foods.service';

@Module({
  imports: [PrismaModule],
  controllers: [FoodsController],
  providers: [FoodsRepository, FoodsService],
})
export class FoodsModule {}

