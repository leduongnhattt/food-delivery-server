import { Module } from '@nestjs/common';
import { MapboxModule } from '@infra/mapbox/mapbox.module';
import { EtaService } from '@modules/shipping/eta.service';
import { DeliveryFeeService } from '@modules/shipping/delivery-fee.service';

@Module({
  imports: [MapboxModule],
  providers: [EtaService, DeliveryFeeService],
  exports: [EtaService, DeliveryFeeService],
})
export class ShippingModule {}

