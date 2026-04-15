import { Module } from '@nestjs/common';
import { SettingsController } from '@modules/settings/settings.controller';
import { AuthModule } from '@modules/auth/auth.module';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { SettingsService } from './settings.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}

