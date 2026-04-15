import { Module } from '@nestjs/common';
import { UsdVndExchangeRateService } from './usd-vnd-exchange-rate.service';

@Module({
  providers: [UsdVndExchangeRateService],
  exports: [UsdVndExchangeRateService],
})
export class ExchangeRateModule {}
