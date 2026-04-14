import { Module } from '@nestjs/common';
import { MapboxClient } from '@infra/mapbox/mapbox.client';

@Module({
  providers: [MapboxClient],
  exports: [MapboxClient],
})
export class MapboxModule {}

