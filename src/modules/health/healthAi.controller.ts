import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import {
  HealthGeminiService,
  type HealthProfileDto,
} from '@modules/health/healthGemini.service';

type HealthAiAnalyzeResponse =
  | { success: true; data: import('./healthGemini.service').GeminiHealthAnalysisDto }
  | { success: false; error: string };

function isValidGender(x: unknown): x is HealthProfileDto['gender'] {
  return x === 'male' || x === 'female' || x === 'other';
}

function isValidActivityLevel(
  x: unknown,
): x is HealthProfileDto['activityLevel'] {
  return (
    x === 'sedentary' ||
    x === 'light' ||
    x === 'moderate' ||
    x === 'active' ||
    x === 'very-active'
  );
}

function isValidHealthGoal(x: unknown): x is HealthProfileDto['healthGoal'] {
  return (
    x === 'weight-loss' ||
    x === 'weight-gain' ||
    x === 'muscle-gain' ||
    x === 'maintenance' ||
    x === 'health-improvement'
  );
}

@Controller('health')
export class HealthAiController {
  constructor(private readonly healthAi: HealthGeminiService) {}

  @Post('ai-analyze')
  async analyze(
    @Body()
    body: {
      age?: number;
      gender?: string;
      height?: number;
      weight?: number;
      activityLevel?: string;
      healthGoal?: string;
      dietaryRestrictions?: string;
    },
  ): Promise<HealthAiAnalyzeResponse> {
    const { age, gender, height, weight, activityLevel, healthGoal } = body ?? {};

    if (
      age == null ||
      gender == null ||
      height == null ||
      weight == null ||
      activityLevel == null ||
      healthGoal == null
    ) {
      throw new BadRequestException('Missing required fields');
    }

    if (age < 1 || age > 120) {
      throw new BadRequestException('Age must be between 1 and 120');
    }
    if (height < 50 || height > 250) {
      throw new BadRequestException('Height must be between 50 and 250 cm');
    }
    if (weight < 20 || weight > 300) {
      throw new BadRequestException('Weight must be between 20 and 300 kg');
    }
    if (!isValidGender(gender)) {
      throw new BadRequestException('Invalid gender value');
    }
    if (!isValidActivityLevel(activityLevel)) {
      throw new BadRequestException('Invalid activity level');
    }
    if (!isValidHealthGoal(healthGoal)) {
      throw new BadRequestException('Invalid health goal');
    }

    const profile: HealthProfileDto = {
      age: Number(age),
      gender,
      height: Number(height),
      weight: Number(weight),
      activityLevel,
      healthGoal,
      dietaryRestrictions: body.dietaryRestrictions || '',
    };

    try {
      const data = await this.healthAi.analyze(profile);
      return { success: true, data };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { success: false, error };
    }
  }
}

