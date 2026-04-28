import { Module } from '@nestjs/common';
import { HealthAiController } from './healthAi.controller';
import { HealthGeminiController } from './healthGemini.controller';
import { HealthGeminiService } from './healthGemini.service';
import { HealthAiHttpService } from './healthAiHttp.service';

@Module({
  controllers: [HealthAiController, HealthGeminiController],
  providers: [HealthAiHttpService, HealthGeminiService],
})
export class HealthModule {}

