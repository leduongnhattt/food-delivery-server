import { Module } from '@nestjs/common';
import { StockController } from '@modules/stock/stock.controller';

@Module({
  controllers: [StockController],
})
export class StockModule {}

