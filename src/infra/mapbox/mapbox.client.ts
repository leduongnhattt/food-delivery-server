import { BadRequestException, Injectable, Logger } from '@nestjs/common';

const MAPBOX_HTTP_TIMEOUT_MS = 8_000;

export type LatLng = { lat: number; lng: number };

export type MapboxForwardGeocodeResult = {
  lat: number;
  lng: number;
  placeName: string | null;
};

export type MapboxMatrixResult = {
  durationSeconds: number;
  distanceMeters: number;
};

type MapboxGeocodeResponse = {
  features?: Array<{
    center?: [number, number]; // [lng, lat]
    place_name?: string;
  }>;
};

type MapboxMatrixResponse = {
  code?: string;
  durations?: number[][];
  distances?: number[][];
};

@Injectable()
export class MapboxClient {
  private readonly logger = new Logger(MapboxClient.name);

  private get token(): string {
    const t = process.env.MAPBOX_TOKEN?.trim();
    if (!t) {
      throw new BadRequestException('MAPBOX_TOKEN is not set');
    }
    return t;
  }

  async forwardGeocode(params: {
    address: string;
    country?: string; // e.g. 'VN'
    limit?: number; // default 1
  }): Promise<MapboxForwardGeocodeResult | null> {
    const address = (params.address || '').trim();
    if (!address) return null;

    const limit = params.limit ?? 1;
    const country = params.country ?? 'VN';

    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`,
    );
    url.searchParams.set('access_token', this.token);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('country', country);
    url.searchParams.set('types', 'address,poi,place');

    const payload = await this.fetchJson<MapboxGeocodeResponse>(url.toString());
    const feature = payload?.features?.[0];
    const center = feature?.center;
    if (!center || center.length !== 2) return null;

    const [lng, lat] = center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      lat,
      lng,
      placeName: feature?.place_name ?? null,
    };
  }

  async matrixDuration(params: {
    origin: LatLng;
    destination: LatLng;
    profile?: 'driving' | 'walking' | 'cycling';
  }): Promise<MapboxMatrixResult | null> {
    const profile = params.profile ?? 'driving';
    const origin = params.origin;
    const destination = params.destination;

    if (
      !Number.isFinite(origin?.lat) ||
      !Number.isFinite(origin?.lng) ||
      !Number.isFinite(destination?.lat) ||
      !Number.isFinite(destination?.lng)
    ) {
      return null;
    }

    // Mapbox uses lng,lat order.
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = new URL(
      `https://api.mapbox.com/directions-matrix/v1/mapbox/${profile}/${coords}`,
    );
    url.searchParams.set('access_token', this.token);
    url.searchParams.set('annotations', 'duration,distance');

    const payload = await this.fetchJson<MapboxMatrixResponse>(url.toString());
    const duration = payload?.durations?.[0]?.[1];
    const distance = payload?.distances?.[0]?.[1];
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      return null;
    }
    if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) {
      return null;
    }
    return { durationSeconds: duration, distanceMeters: distance };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MAPBOX_HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`Mapbox request failed: ${res.status} ${res.statusText}`);
        throw new BadRequestException('Mapbox request failed');
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

