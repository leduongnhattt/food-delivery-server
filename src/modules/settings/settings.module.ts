import { Module } from '@nestjs/common';
import { SettingsController } from '@modules/settings/settings.controller';
import { AuthModule } from '@modules/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SettingsController],
})
export class SettingsModule {}

