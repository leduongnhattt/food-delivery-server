import { Injectable } from '@nestjs/common';
import type {
  GeminiHealthAnalysisDto,
  HealthProfileDto,
} from '@modules/health/healthGemini.service';

function normalizeBaseUrl(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return 'http://127.0.0.1:8000';
  return t.replace(/\/+$/, '');
}

function envBool(name: string, defaultValue: boolean): boolean {
  const v = (process.env[name] || '').trim().toLowerCase();
  if (!v) return defaultValue;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return defaultValue;
}

function envInt(name: string, defaultValue: number): number {
  const v = (process.env[name] || '').trim();
  if (!v) return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

@Injectable()
export class HealthAiHttpService {
  isEnabled(): boolean {
    return envBool('HEALTH_AI_ENABLED', true);
  }

  async recommend(profile: HealthProfileDto): Promise<GeminiHealthAnalysisDto> {
    const baseUrl = normalizeBaseUrl(process.env.HEALTH_AI_BASE_URL || '');
    // /recommend can be slow if health-ai-service enables local LLM enrichment.
    // Keep the default aligned with health-ai-service LLAMA_TIMEOUT_S (90s).
    const timeoutMs = envInt('HEALTH_AI_TIMEOUT_MS', 90000);
    const url = `${baseUrl}/recommend`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
        signal: controller.signal,
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(
          `health-ai-service error ${res.status}: ${bodyText || res.statusText}`,
        );
      }

      const json = (await res.json()) as GeminiHealthAnalysisDto;
      if (!json || typeof json !== 'object') {
        throw new Error('health-ai-service returned empty JSON');
      }
      return json;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`health-ai-service timeout after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }
}

