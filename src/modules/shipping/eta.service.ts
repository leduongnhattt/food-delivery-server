import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { MapboxClient, type LatLng } from '@infra/mapbox/mapbox.client';
import { getKeyJson, setKeyJson } from '@infra/redis/redis.service';
import crypto from 'crypto';

type DeliveryInfo = {
  address: string;
  lat?: number;
  lng?: number;
};

export type EtaComputeSource = 'gps' | 'geocoded' | 'fallback';

export type PersistedEtaResult = {
  estimatedDeliveryTime: Date | null;
  etaMinutes: number | null;
  source: EtaComputeSource;
  distanceMeters?: number;
  durationSeconds?: number;
};

const DEFAULTS = {
  basePrepMinutes: 20,
  minEtaMinutes: 30,
  maxEtaMinutes: 180,
  matrixCacheTtlSeconds: 30 * 60,
  geocodeCacheTtlSeconds: 30 * 24 * 60 * 60,
} as const;

@Injectable()
export class EtaService {
  private readonly logger = new Logger(EtaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapbox: MapboxClient,
  ) {}

  async computeAndPersistForOrder(params: {
    orderId: string;
    enterpriseId: string;
    deliveryInfo: DeliveryInfo;
    force?: boolean;
  }): Promise<PersistedEtaResult> {
    const orderId = params.orderId?.trim();
    const enterpriseId = params.enterpriseId?.trim();
    if (!orderId) throw new BadRequestException('orderId is required');
    if (!enterpriseId) throw new BadRequestException('enterpriseId is required');

    const order = await this.prisma.order.findUnique({
      where: { OrderID: orderId },
      select: {
        OrderID: true,
        OrderDate: true,
        EstimatedDeliveryTime: true,
        Metadata: true,
      },
    });
    if (!order) throw new BadRequestException('Order not found');
    if (order.EstimatedDeliveryTime && !params.force) {
      return {
        estimatedDeliveryTime: order.EstimatedDeliveryTime,
        etaMinutes: null,
        source: 'fallback',
      };
    }

    const enterprise = await this.prisma.enterprise.findUnique({
      where: { EnterpriseID: enterpriseId },
      select: { Latitude: true, Longitude: true },
    });

    const origin = this.toLatLng({
      lat: enterprise?.Latitude != null ? Number(enterprise.Latitude) : undefined,
      lng: enterprise?.Longitude != null ? Number(enterprise.Longitude) : undefined,
    });

    const customerCoordsFromGps = this.toLatLng({
      lat: params.deliveryInfo.lat,
      lng: params.deliveryInfo.lng,
    });

    const deliveryAddress = (params.deliveryInfo.address ?? '').trim();

    let customerDestination: LatLng | null = customerCoordsFromGps;
    let etaSource: EtaComputeSource = customerCoordsFromGps ? 'gps' : 'geocoded';

    if (!customerDestination) {
      customerDestination = await this.geocodeAddressCached(deliveryAddress);
    }

    if (!origin || !customerDestination) {
      const etaMinutes = 45;
      const estimatedDeliveryTime = new Date(order.OrderDate.getTime() + etaMinutes * 60_000);
      await this.persistEta(orderId, order.Metadata, {
        estimatedDeliveryTime,
        etaMinutes,
        source: 'fallback',
      });
      return { estimatedDeliveryTime, etaMinutes, source: 'fallback' };
    }

    // Prefer routing matrix; fallback to Haversine-based estimate.
    const routeMetrics = await this.matrixCached(origin, customerDestination);
    if (!routeMetrics) {
      const etaMinutes = this.clampEtaMinutes(
        this.readBasePrepMinutes() +
          this.estimateTravelMinutesByHaversine(origin, customerDestination),
      );
      const estimatedDeliveryTime = new Date(order.OrderDate.getTime() + etaMinutes * 60_000);
      await this.persistEta(orderId, order.Metadata, {
        estimatedDeliveryTime,
        etaMinutes,
        source: 'fallback',
      });
      return { estimatedDeliveryTime, etaMinutes, source: 'fallback' };
    }

    const travelMinutes = Math.ceil(routeMetrics.durationSeconds / 60);
    const etaMinutes = this.clampEtaMinutes(this.readBasePrepMinutes() + travelMinutes);
    const estimatedDeliveryTime = new Date(order.OrderDate.getTime() + etaMinutes * 60_000);

    await this.persistEta(orderId, order.Metadata, {
      estimatedDeliveryTime,
      etaMinutes,
      source: etaSource,
      durationSeconds: routeMetrics.durationSeconds,
      distanceMeters: routeMetrics.distanceMeters,
    });

    return {
      estimatedDeliveryTime,
      etaMinutes,
      source: etaSource,
      durationSeconds: routeMetrics.durationSeconds,
      distanceMeters: routeMetrics.distanceMeters,
    };
  }

  private readBasePrepMinutes(): number {
    const raw = process.env.ETA_BASE_PREP_MINUTES;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
    return DEFAULTS.basePrepMinutes;
  }

  private readMinEtaMinutes(): number {
    const raw = process.env.ETA_MIN_MINUTES;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
    return DEFAULTS.minEtaMinutes;
  }

  private readMaxEtaMinutes(): number {
    const raw = process.env.ETA_MAX_MINUTES;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
    return DEFAULTS.maxEtaMinutes;
  }

  private clampEtaMinutes(minutes: number): number {
    const minMinutes = this.readMinEtaMinutes();
    const maxMinutes = this.readMaxEtaMinutes();
    return Math.max(minMinutes, Math.min(maxMinutes, Math.max(1, Math.round(minutes))));
  }

  private toLatLng(coords: { lat?: number; lng?: number }): LatLng | null {
    if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null;
    return { lat: coords.lat!, lng: coords.lng! };
  }

  private normalizeAddress(address: string): string {
    return address.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private sha1(plaintext: string): string {
    return crypto.createHash('sha1').update(plaintext).digest('hex');
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
      const forwardGeocodeHit = await this.mapbox.forwardGeocode({
        address,
        country: 'VN',
        limit: 1,
      });
      if (!forwardGeocodeHit) return null;
      const coords = { lat: forwardGeocodeHit.lat, lng: forwardGeocodeHit.lng };
      await setKeyJson(key, coords, DEFAULTS.geocodeCacheTtlSeconds);
      return coords;
    } catch (err) {
      this.logger.warn(`Forward geocode failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private roundCoord(n: number): number {
    return Math.round(n * 100000) / 100000;
  }

  private async matrixCached(origin: LatLng, destination: LatLng) {
    const roundedOrigin = {
      lat: this.roundCoord(origin.lat),
      lng: this.roundCoord(origin.lng),
    };
    const roundedDestination = {
      lat: this.roundCoord(destination.lat),
      lng: this.roundCoord(destination.lng),
    };
    const key = `geo:mx:driving:${roundedOrigin.lng},${roundedOrigin.lat}:${roundedDestination.lng},${roundedDestination.lat}`;

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
      const matrixResult = await this.mapbox.matrixDuration({
        origin,
        destination,
        profile: 'driving',
      });
      if (!matrixResult) return null;
      await setKeyJson(key, matrixResult, DEFAULTS.matrixCacheTtlSeconds);
      return matrixResult;
    } catch (err) {
      this.logger.warn(`Matrix call failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private estimateTravelMinutesByHaversine(origin: LatLng, destination: LatLng): number {
    const km = this.haversineKm(origin, destination);
    // Typical urban motorbike speed; keep conservative.
    const avgSpeedKmH = 18;
    const minutes = (km / avgSpeedKmH) * 60;
    if (!Number.isFinite(minutes) || minutes <= 0) return 25;
    return Math.ceil(minutes);
  }

  private haversineKm(from: LatLng, to: LatLng): number {
    const earthRadiusKm = 6371;
    const deltaLatRad = this.degToRad(to.lat - from.lat);
    const deltaLngRad = this.degToRad(to.lng - from.lng);
    const fromLatRad = this.degToRad(from.lat);
    const toLatRad = this.degToRad(to.lat);
    const halfChordSquared =
      Math.sin(deltaLatRad / 2) ** 2 +
      Math.cos(fromLatRad) * Math.cos(toLatRad) * Math.sin(deltaLngRad / 2) ** 2;
    const centralAngle = 2 * Math.atan2(Math.sqrt(halfChordSquared), Math.sqrt(1 - halfChordSquared));
    return earthRadiusKm * centralAngle;
  }

  private degToRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  private async persistEta(
    orderId: string,
    existingMetadata: unknown,
    etaResult: PersistedEtaResult,
  ) {
    const existingMetadataRecord =
      existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata)
        ? (existingMetadata as Record<string, unknown>)
        : {};

    const mergedMetadata = {
      ...existingMetadataRecord,
      eta: {
        etaMinutes: etaResult.etaMinutes,
        source: etaResult.source,
        distanceMeters: etaResult.distanceMeters,
        durationSeconds: etaResult.durationSeconds,
        provider: etaResult.source === 'fallback' ? 'fallback' : 'mapbox',
        updatedAt: new Date().toISOString(),
      },
    };

    await this.prisma.order.update({
      where: { OrderID: orderId },
      data: {
        EstimatedDeliveryTime: etaResult.estimatedDeliveryTime,
        Metadata: mergedMetadata,
      },
    });
  }
}

