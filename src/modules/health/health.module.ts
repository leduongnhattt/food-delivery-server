import { Module } from '@nestjs/common';
import { HealthGeminiController } from './healthGemini.controller';
import { HealthGeminiService } from './healthGemini.service';

@Module({
  controllers: [HealthGeminiController],
  providers: [HealthGeminiService],
})
export class HealthModule {}

