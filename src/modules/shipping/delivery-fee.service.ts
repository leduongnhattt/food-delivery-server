import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { MapboxClient, type LatLng } from '@infra/mapbox/mapbox.client';
import { getKeyJson, setKeyJson } from '@infra/redis/redis.service';
import crypto from 'crypto';

type DeliveryInfo = {
  address?: string;
  lat?: number;
  lng?: number;
};

export type DeliveryFeeQuote = {
  deliveryFee: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
  source: 'matrix' | 'geocoded' | 'fallback';
};

const DEFAULTS = {
  baseFee: 0.5,
  perKmFee: 0.2,
  minFee: 0.5,
  maxFee: 5.0,
  matrixCacheTtlSeconds: 30 * 60,
  geocodeCacheTtlSeconds: 30 * 24 * 60 * 60,
} as const;

@Injectable()
export class DeliveryFeeService {
  private readonly logger = new Logger(DeliveryFeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapbox: MapboxClient,
  ) {}

  async quoteForEnterprise(params: {
    enterpriseId: string;
    deliveryInfo: DeliveryInfo;
  }): Promise<DeliveryFeeQuote> {
    const enterpriseId = (params.enterpriseId ?? '').trim();
    if (!enterpriseId) throw new BadRequestException('enterpriseId is required');

    const enterprise = await this.prisma.enterprise.findUnique({
      where: { EnterpriseID: enterpriseId },
      select: { Latitude: true, Longitude: true, Address: true },
    });
    if (!enterprise) throw new BadRequestException('Enterprise not found');

    const origin = await this.resolveOriginFromEnterprise(enterprise);
    const destination = await this.resolveDestination(params.deliveryInfo);

    if (!origin || !destination) {
      const deliveryFee = this.computeFeeFromDistanceMeters(null);
      return {
        deliveryFee,
        distanceMeters: null,
        durationSeconds: null,
        source: 'fallback',
      };
    }

    const metrics = await this.matrixCached(origin, destination);
    if (!metrics) {
      const deliveryFee = this.computeFeeFromDistanceMeters(null);
      return {
        deliveryFee,
        distanceMeters: null,
        durationSeconds: null,
        source: 'fallback',
      };
    }

    const deliveryFee = this.computeFeeFromDistanceMeters(metrics.distanceMeters);
    return {
      deliveryFee,
      distanceMeters: metrics.distanceMeters,
      durationSeconds: metrics.durationSeconds,
      source: 'matrix',
    };
  }

  private computeFeeFromDistanceMeters(distanceMeters: number | null): number {
    const baseFee = this.readNumberEnv('DELIVERY_FEE_BASE', DEFAULTS.baseFee);
    const perKmFee = this.readNumberEnv('DELIVERY_FEE_PER_KM', DEFAULTS.perKmFee);
    const minFee = this.readNumberEnv('DELIVERY_FEE_MIN', DEFAULTS.minFee);
    const maxFee = this.readNumberEnv('DELIVERY_FEE_MAX', DEFAULTS.maxFee);

    const meters = typeof distanceMeters === 'number' && Number.isFinite(distanceMeters) && distanceMeters > 0
      ? distanceMeters
      : null;
    const km = meters != null ? meters / 1000 : 0;
    const billedKm = meters != null ? Math.max(1, Math.ceil(km)) : 0;

    const raw = baseFee + perKmFee * billedKm;
    const clamped = Math.max(minFee, Math.min(maxFee, raw));
    return Math.round(clamped * 100) / 100;
  }

  private readNumberEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  private toLatLng(v: { lat?: number; lng?: number }): LatLng | null {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return null;
    return { lat: v.lat!, lng: v.lng! };
  }

  private normalizeAddress(address: string): string {
    return address.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private sha1(s: string): string {
    return crypto.createHash('sha1').update(s).digest('hex');
  }

  private roundCoord(n: number): number {
    return Math.round(n * 100000) / 100000;
  }

  private async resolveOriginFromEnterprise(row: {
    Latitude: unknown;
    Longitude: unknown;
    Address: string;
  }): Promise<LatLng | null> {
    const lat =
      row.Latitude != null && Number.isFinite(Number(row.Latitude))
        ? Number(row.Latitude)
        : undefined;
    const lng =
      row.Longitude != null && Number.isFinite(Number(row.Longitude))
        ? Number(row.Longitude)
        : undefined;
    const fromDb = this.toLatLng({ lat, lng });
    if (fromDb) return fromDb;

    const address = (row.Address ?? '').trim();
    if (!address) return null;
    return this.geocodeAddressCached(address);
  }

  private async resolveDestination(input?: DeliveryInfo): Promise<LatLng | null> {
    const fromGps = this.toLatLng({ lat: input?.lat, lng: input?.lng });
    if (fromGps) return fromGps;

    const address = (input?.address ?? '').trim();
    if (!address) return null;
    return this.geocodeAddressCached(address);
  }

  private async geocodeAddressCached(address: string): Promise<LatLng | null> {
    const normalized = this.normalizeAddress(address);
    if (!normalized) return null;
    const key = `geo:fw:vn:${this.sha1(normalized)}`;

    const cached = await getKeyJson<{ lat: number; lng: number }>(key);
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
      return { lat: cached.lat, lng: cached.lng };
    }

    try {
      const hit = await this.mapbox.forwardGeocode({
        address,
        country: 'VN',
        limit: 1,
      });
      if (!hit) return null;
      const coords = { lat: hit.lat, lng: hit.lng };
      await setKeyJson(key, coords, DEFAULTS.geocodeCacheTtlSeconds);
      return coords;
    } catch (err) {
      this.logger.warn(
        `Forward geocode failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  private async matrixCached(origin: LatLng, destination: LatLng) {
    const o = { lat: this.roundCoord(origin.lat), lng: this.roundCoord(origin.lng) };
    const d = { lat: this.roundCoord(destination.lat), lng: this.roundCoord(destination.lng) };
    const key = `geo:mx:driving:${o.lng},${o.lat}:${d.lng},${d.lat}`;

    const cached = await getKeyJson<{ durationSeconds: number; distanceMeters: number }>(key);
    if (
      cached &&
      typeof cached.durationSeconds === 'number' &&
      Number.isFinite(cached.durationSeconds) &&
      typeof cached.distanceMeters === 'number' &&
      Number.isFinite(cached.distanceMeters)
    ) {
      return cached;
    }

    try {
      const r = await this.mapbox.matrixDuration({
        origin,
        destination,
        profile: 'driving',
      });
      if (!r) return null;
      await setKeyJson(key, r, DEFAULTS.matrixCacheTtlSeconds);
      return r;
    } catch (err) {
      this.logger.warn(`Matrix call failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}

