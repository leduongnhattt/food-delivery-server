import { Module } from '@nestjs/common';
import { RegistryController } from '@modules/registry/registry.controller';

@Module({
  controllers: [RegistryController],
})
export class RegistryModule {}

