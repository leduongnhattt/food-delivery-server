import { Module } from '@nestjs/common';
import { MapboxModule } from '@infra/mapbox/mapbox.module';
import { EtaService } from '@modules/shipping/eta.service';

@Module({
  imports: [MapboxModule],
  providers: [EtaService],
  exports: [EtaService],
})
export class ShippingModule {}

