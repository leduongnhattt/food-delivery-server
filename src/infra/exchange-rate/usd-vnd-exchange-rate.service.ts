import { BadRequestException, Injectable, Logger } from '@nestjs/common';

const QUOTE_HTTP_TIMEOUT_MS = 8_000;
const FALLBACK_RATE_CACHE_TTL_MS = 300_000;

export type UsdVndExchangeRateQuote = {
  vndPerUsd: number;
  fxQuoteHost: string;
};

type CachedUsdVndQuote = {
  vndPerUsd: number;
  expiresAtMs: number;
  fxQuoteHost: string;
};

@Injectable()
export class UsdVndExchangeRateService {
  private readonly logger = new Logger(UsdVndExchangeRateService.name);
  private cachedQuote: CachedUsdVndQuote | null = null;

  async getUsdToVndExchangeRate(): Promise<UsdVndExchangeRateQuote> {
    const cacheTtlMs = this.readCacheTtlMsFromEnv();
    const nowMs = Date.now();

    if (
      this.cachedQuote &&
      this.cachedQuote.expiresAtMs > nowMs &&
      Number.isFinite(this.cachedQuote.vndPerUsd)
    ) {
      return {
        vndPerUsd: this.cachedQuote.vndPerUsd,
        fxQuoteHost: this.cachedQuote.fxQuoteHost,
      };
    }

    const fallbackVndPerUsd = this.readOptionalFallbackVndPerUsdFromEnv();

    for (const endpointUrl of this.readQuoteEndpointUrlsFromEnv()) {
      const quote = await this.fetchVndPerUsdFromEndpoint(
        endpointUrl,
        cacheTtlMs,
        nowMs,
      );
      if (quote) return quote;
    }

    if (fallbackVndPerUsd != null) {
      this.logger.warn(
        'Using VNP_USD_TO_VND_RATE: market quote endpoints failed or returned invalid data',
      );
      this.cachedQuote = {
        vndPerUsd: fallbackVndPerUsd,
        expiresAtMs: nowMs + FALLBACK_RATE_CACHE_TTL_MS,
        fxQuoteHost: 'env_fallback',
      };
      return {
        vndPerUsd: fallbackVndPerUsd,
        fxQuoteHost: 'env_fallback',
      };
    }

    throw new BadRequestException(
      'Unable to resolve USD/VND rate. Configure VNP_USD_TO_VND_RATE as fallback or fix quote URLs.',
    );
  }

  private readQuoteEndpointUrlsFromEnv(): string[] {
    const raw = process.env.VNP_FX_USD_QUOTE_URLS?.trim();
    if (!raw) {
      throw new BadRequestException('VNP_FX_USD_QUOTE_URLS is not set');
    }
    const urls = raw.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      throw new BadRequestException('VNP_FX_USD_QUOTE_URLS is empty');
    }
    return urls;
  }

  private readCacheTtlMsFromEnv(): number {
    const raw = process.env.VNP_FX_CACHE_TTL_MS?.trim();
    if (!raw) {
      throw new BadRequestException('VNP_FX_CACHE_TTL_MS is not set');
    }
    const ms = Number(raw);
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new BadRequestException(
        'VNP_FX_CACHE_TTL_MS must be a positive number (milliseconds)',
      );
    }
    return ms;
  }

  private readOptionalFallbackVndPerUsdFromEnv(): number | undefined {
    const n = Number(process.env.VNP_USD_TO_VND_RATE);
    if (Number.isFinite(n) && n > 0) return n;
    return undefined;
  }

  private resolveFxQuoteHost(endpointUrl: string): string {
    try {
      return new URL(endpointUrl).hostname;
    } catch {
      return 'unknown_quote_host';
    }
  }

  private extractVndPerUsdFromOpenExchangeStyleJson(payload: unknown): number | undefined {
    const rates = (payload as { rates?: { VND?: number } })?.rates;
    const vnd = rates?.VND;
    if (typeof vnd !== 'number' || !Number.isFinite(vnd) || vnd <= 0) return undefined;
    return vnd;
  }

  private async fetchVndPerUsdFromEndpoint(
    endpointUrl: string,
    cacheTtlMs: number,
    nowMs: number,
  ): Promise<UsdVndExchangeRateQuote | undefined> {
    const fxQuoteHost = this.resolveFxQuoteHost(endpointUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), QUOTE_HTTP_TIMEOUT_MS);
    try {
      const response = await fetch(endpointUrl, { signal: controller.signal });
      if (!response.ok) return undefined;
      const payload: unknown = await response.json();
      const vndPerUsd = this.extractVndPerUsdFromOpenExchangeStyleJson(payload);
      if (vndPerUsd == null) return undefined;

      this.cachedQuote = {
        vndPerUsd,
        expiresAtMs: nowMs + cacheTtlMs,
        fxQuoteHost,
      };
      return { vndPerUsd, fxQuoteHost };
    } catch (err) {
      this.logger.warn(
        `Quote fetch failed (${fxQuoteHost}): ${err instanceof Error ? err.message : err}`,
      );
      return undefined;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
