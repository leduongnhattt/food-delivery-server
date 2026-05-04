import { Injectable } from '@nestjs/common';

type SupportedLocale = 'en' | 'vi';

function getSystemLocale(): SupportedLocale {
  const envLocale = (process.env.LOCALE || 'en').toLowerCase();
  return envLocale.startsWith('vi') ? 'vi' : 'en';
}

export interface HealthProfileDto {
  age: number;
  gender: 'male' | 'female' | 'other';
  height: number;
  weight: number;
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very-active';
  healthGoal:
  | 'weight-loss'
  | 'weight-gain'
  | 'muscle-gain'
  | 'maintenance'
  | 'health-improvement';
  dietaryRestrictions?: string;
}

export interface HealthAnalysisDto {
  bmi: number;
  bmiCategory: string;
  bmr: number;
  tdee: number;
  recommendedCalories: number;
  macronutrients: { protein: number; carbs: number; fat: number };
  healthStatus: string;
  healthRisks: string[];
  healthInsights: string[];
  recommendations: string[];
}

export interface ExerciseRecommendationDto {
  name: string;
  description: string;
  duration: string;
  frequency: string;
  difficultyLevel: string;
  benefits: string[];
  tutorialLink: string;
  equipment: string;
  instructions: string[];
}

export interface MealPlanDto {
  day: string;
  breakfast: { meal: string; calories: number; description: string };
  lunch: { meal: string; calories: number; description: string };
  dinner: { meal: string; calories: number; description: string };
  snack: { meal: string; calories: number; description: string };
  dailyTotalCalories: number;
}

export interface FoodRecommendationDto {
  category: string;
  eat: string[];
  avoid: string[];
  benefits?: string;
}

export interface GeminiHealthAnalysisDto {
  analysis: HealthAnalysisDto;
  exerciseRecommendations: ExerciseRecommendationDto[];
  foodRecommendations: FoodRecommendationDto[];
  weeklyMealPlan: MealPlanDto[];
  aiInsights: Array<{
    category: string;
    priority: 'high' | 'medium' | 'low';
    insight: string;
    reasoning: string;
    actionable: string;
    confidence: number;
  }>;
  aiRecommendations: Array<{
    type: string;
    title: string;
    description: string;
    reasoning: string;
    priority: number;
    timeframe: string;
    difficulty: string;
    expectedOutcome: string;
  }>;
  personalityProfile: {
    eatingStyle: string;
    motivation: string;
    challenges: string[];
    strengths: string[];
    preferences: string[];
  };
}

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

function cleanJsonText(text: string): string {
  return text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

function getActivityLevelVi(level: HealthProfileDto['activityLevel']): string {
  const map: Record<HealthProfileDto['activityLevel'], string> = {
    sedentary: 'Ít vận động (ít/không tập thể dục)',
    light: 'Hoạt động nhẹ (tập thể dục nhẹ 1-3 ngày/tuần)',
    moderate: 'Hoạt động vừa phải (tập thể dục vừa phải 3-5 ngày/tuần)',
    active: 'Rất hoạt động (tập thể dục mạnh 6-7 ngày/tuần)',
    'very-active': 'Cực kỳ hoạt động (tập thể dục rất mạnh và công việc thể chất)',
  };
  return map[level];
}

function getHealthGoalVi(goal: HealthProfileDto['healthGoal']): string {
  const map: Record<HealthProfileDto['healthGoal'], string> = {
    'weight-loss': 'Giảm cân',
    'weight-gain': 'Tăng cân',
    'muscle-gain': 'Tăng cơ',
    maintenance: 'Duy trì cân nặng',
    'health-improvement': 'Cải thiện sức khỏe tổng thể',
  };
  return map[goal];
}

function buildPrompt(locale: SupportedLocale, profile: HealthProfileDto): string {
  if (locale === 'vi') {
    return `Bạn là một chuyên gia dinh dưỡng, huấn luyện viên thể dục và chuyên gia sức khỏe. Hãy phân tích hồ sơ sức khỏe sau và TỰ TÍNH TOÁN toàn bộ chỉ số (BMI, BMR, TDEE, macronutrients) theo công thức chuẩn, sau đó xuất JSON đúng schema bên dưới.

HỒ SƠ:
- Tuổi: ${profile.age} tuổi
- Giới tính: ${profile.gender === 'male' ? 'Nam' : profile.gender === 'female' ? 'Nữ' : 'Khác'}
- Chiều cao: ${profile.height} cm
- Cân nặng: ${profile.weight} kg
- Mức độ hoạt động: ${getActivityLevelVi(profile.activityLevel)}
- Mục tiêu sức khỏe: ${getHealthGoalVi(profile.healthGoal)}
- Hạn chế ăn uống: ${profile.dietaryRestrictions || 'Không có'}

QUAN TRỌNG: Chỉ trả về JSON hợp lệ. Nếu có code fence thì dùng \`\`\`json...\`\`\` cũng được.

Schema:
{
  "analysis": {
    "bmi": <number>,
    "bmiCategory": "<string>",
    "bmr": <number>,
    "tdee": <number>,
    "recommendedCalories": <number>,
    "macronutrients": { "protein": <number>, "carbs": <number>, "fat": <number> },
    "healthStatus": "<string>",
    "healthRisks": ["<string>"],
    "healthInsights": ["<string>"],
    "recommendations": ["<string>"]
  },
  "exerciseRecommendations": [
    {
      "name": "<string>",
      "description": "<string>",
      "duration": "<string>",
      "frequency": "<string>",
      "difficultyLevel": "<string>",
      "benefits": ["<string>"],
      "tutorialLink": "<string>",
      "equipment": "<string>",
      "instructions": ["<string>"]
    }
  ],
  "foodRecommendations": [
    { "category": "<string>", "eat": ["<string>"], "avoid": ["<string>"], "benefits": "<string>" }
  ],
  "weeklyMealPlan": [
    {
      "day": "<string>",
      "breakfast": { "meal": "<string>", "calories": <number>, "description": "<string>" },
      "lunch": { "meal": "<string>", "calories": <number>, "description": "<string>" },
      "dinner": { "meal": "<string>", "calories": <number>, "description": "<string>" },
      "snack": { "meal": "<string>", "calories": <number>, "description": "<string>" },
      "dailyTotalCalories": <number>
    }
  ],
  "aiInsights": [
    { "category": "<string>", "priority": "high", "insight": "<string>", "reasoning": "<string>", "actionable": "<string>", "confidence": <number> }
  ],
  "aiRecommendations": [
    { "type": "<string>", "title": "<string>", "description": "<string>", "reasoning": "<string>", "priority": <number>, "timeframe": "<string>", "difficulty": "<string>", "expectedOutcome": "<string>" }
  ],
  "personalityProfile": {
    "eatingStyle": "<string>",
    "motivation": "<string>",
    "challenges": ["<string>"],
    "strengths": ["<string>"],
    "preferences": ["<string>"]
  }
}`;
  }

  return `You are a professional nutritionist, fitness trainer, and health expert. Analyze this health profile and return valid JSON matching the schema below.

PROFILE:
- Age: ${profile.age}
- Gender: ${profile.gender}
- Height: ${profile.height}cm
- Weight: ${profile.weight}kg
- Activity Level: ${profile.activityLevel}
- Health Goal: ${profile.healthGoal}
- Dietary Restrictions: ${profile.dietaryRestrictions || 'None'}

IMPORTANT: Return valid JSON only.

Schema:
{
  "analysis": {
    "bmi": <number>,
    "bmiCategory": "<string>",
    "bmr": <number>,
    "tdee": <number>,
    "recommendedCalories": <number>,
    "macronutrients": { "protein": <number>, "carbs": <number>, "fat": <number> },
    "healthStatus": "<string>",
    "healthRisks": ["<string>"],
    "healthInsights": ["<string>"],
    "recommendations": ["<string>"]
  },
  "exerciseRecommendations": [
    {
      "name": "<string>",
      "description": "<string>",
      "duration": "<string>",
      "frequency": "<string>",
      "difficultyLevel": "<string>",
      "benefits": ["<string>"],
      "tutorialLink": "<string>",
      "equipment": "<string>",
      "instructions": ["<string>"]
    }
  ],
  "foodRecommendations": [
    { "category": "<string>", "eat": ["<string>"], "avoid": ["<string>"], "benefits": "<string>" }
  ],
  "weeklyMealPlan": [
    {
      "day": "<string>",
      "breakfast": { "meal": "<string>", "calories": <number>, "description": "<string>" },
      "lunch": { "meal": "<string>", "calories": <number>, "description": "<string>" },
      "dinner": { "meal": "<string>", "calories": <number>, "description": "<string>" },
      "snack": { "meal": "<string>", "calories": <number>, "description": "<string>" },
      "dailyTotalCalories": <number>
    }
  ],
  "aiInsights": [
    { "category": "<string>", "priority": "high", "insight": "<string>", "reasoning": "<string>", "actionable": "<string>", "confidence": <number> }
  ],
  "aiRecommendations": [
    { "type": "<string>", "title": "<string>", "description": "<string>", "reasoning": "<string>", "priority": <number>, "timeframe": "<string>", "difficulty": "<string>", "expectedOutcome": "<string>" }
  ],
  "personalityProfile": {
    "eatingStyle": "<string>",
    "motivation": "<string>",
    "challenges": ["<string>"],
    "strengths": ["<string>"],
    "preferences": ["<string>"]
  }
}`;
}

@Injectable()
export class HealthGeminiService {
  /** Used when `GEMINI_MODEL` is unset (Google renames models over time). */
  private readonly modelsToTry = [
    // NOTE: Gemini model aliases change over time; prefer stable names.
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
  ] as const;

  async analyze(profile: HealthProfileDto): Promise<GeminiHealthAnalysisDto> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY is missing. Set it to use Google Gemini for POST /health/gemini-analyze and POST /health/ai-analyze.',
      );
    }

    const locale = getSystemLocale();
    const prompt = buildPrompt(locale, profile);

    const configuredModel = (process.env.GEMINI_MODEL || '').trim();
    const models = configuredModel ? [configuredModel] : [...this.modelsToTry];

    let lastError: string | null = null;
    for (const model of models) {
      try {
        const text = await this.generateContent(apiKey, model, prompt);
        const cleaned = cleanJsonText(text);
        return JSON.parse(cleaned) as GeminiHealthAnalysisDto;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        continue;
      }
    }

    throw new Error(
      lastError || 'All Gemini models failed to generate content.',
    );
  }

  private async generateContent(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<string> {
    const base = (
      process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
    )
      .trim()
      .replace(/\/+$/, '');
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${bodyText}`);
    }

    const json = (await res.json()) as GeminiGenerateContentResponse;
    const text =
      json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) {
      throw new Error('Empty Gemini response');
    }
    return text;
  }
}

