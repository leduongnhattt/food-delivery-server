import { Module } from '@nestjs/common';
import { FoodsController } from '@modules/foods/foods.controller';
import { FoodsService } from '@modules/foods/foods.service';

@Module({
  controllers: [FoodsController],
  providers: [FoodsService],
})
export class FoodsModule {}

