import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RestaurantsRepository,
  RestaurantListCriteria,
  RestaurantsRepositoryLimits,
} from '@infra/repositories/restaurants.repository';
import { MapboxClient, type LatLng } from '@infra/mapbox/mapbox.client';
import { getKeyJson, setKeyJson } from '@infra/redis/redis.service';
import crypto from 'crypto';

export interface RestaurantListItem {
  id: string;
  name: string;
  description: string;
  address: string;
  phone: string;
  avatarUrl: string;
  rating: number;
  deliveryTime: string;
  minimumOrder: number;
  isOpen: boolean;
  openHours?: string;
  closeHours?: string;
  createdAt: Date;
  updatedAt: Date;
  popularFoods: Array<{
    foodId: string;
    dishName: string;
    price: number;
    imageUrl: string;
    category: string;
  }>;
  totalFoods: number;
  totalReviews: number;
}

export interface RestaurantDetailDto extends RestaurantListItem {
  foods: Array<{
    foodId: string;
    dishName: string;
    price: number;
    stock: number;
    description: string;
    imageUrl: string;
    restaurantId: string;
    menu: { menuId: string; category: string };
  }>;
  reviews: Array<{
    id: string;
    rating: number;
    comment: string;
    customerName: string;
    createdAt: Date;
  }>;
}

export interface RestaurantsListResponse {
  restaurants: RestaurantListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface RestaurantReviewsResponse {
  reviews: Array<{
    id: string;
    author: string;
    rating: number;
    content: string;
    images: string[];
    createdAt: string;
    updatedAt: string | null;
  }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  averageRating: number;
  totalReviews: number;
}

const DEFAULT_DELIVERY_TIME = '30-45 min';
const DEFAULT_MINIMUM_ORDER = 0;
const DELIVERY_TIME_CACHE_TTL_SECONDS = 30 * 60;
const DEFAULT_BASE_PREP_MINUTES = 20;
const DEFAULT_MIN_DELIVERY_MINUTES = 10;
const DEFAULT_MAX_DELIVERY_MINUTES = 240;

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly repo: RestaurantsRepository,
    private readonly mapbox: MapboxClient,
  ) { }

  async findMany(
    criteria: RestaurantListCriteria,
    destination?: { address?: string; lat?: number; lng?: number },
  ): Promise<RestaurantsListResponse> {
    const where = this.repo.buildWhereFromCriteria(criteria);
    const { page, limit, skip } = this.repo.normalizePagination(
      criteria.page,
      criteria.limit,
    );

    const { rows, total } = await this.repo.findManyWithCount(
      where,
      { CreatedAt: 'desc' },
      skip,
      limit,
    );

    const dest = await this.resolveDestination(destination);
    const etaLabels = dest
      ? await Promise.all(
        rows.map(async (r) => {
          const origin = await this.resolveOriginFromEnterpriseRow(r);
          if (!origin) return null;
          return this.computeDeliveryTimeLabel({
            origin,
            destination: dest,
          });
        }),
      )
      : rows.map(() => null);

    const restaurants: RestaurantListItem[] = rows.map((r, idx) =>
      this.mapRowToListItem(r, etaLabels[idx] ?? null),
    );

    return {
      restaurants,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(
    id: string,
    destination?: { address?: string; lat?: number; lng?: number },
  ): Promise<RestaurantDetailDto> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException('Restaurant not found');
    }

    const foods = row.foods.map((f) => ({
      foodId: f.FoodID,
      dishName: f.DishName,
      price: Number(f.Price),
      stock: f.Stock,
      description: f.Description ?? '',
      imageUrl: f.ImageURL ?? '',
      restaurantId: row.EnterpriseID,
      menu: {
        menuId: f.foodCategory.CategoryID,
        category: f.foodCategory.CategoryName,
      },
    }));

    const reviews = row.reviews.map((r) => ({
      id: '',
      rating: r.Rating ?? 0,
      comment: r.Comment ?? '',
      customerName: (r.customer as { FullName?: string })?.FullName ?? 'Anonymous',
      createdAt: r.CreatedAt,
    }));

    const dest = await this.resolveDestination(destination);
    const origin = await this.resolveOriginFromEnterpriseRow(row);
    const etaLabel =
      origin && dest
        ? await this.computeDeliveryTimeLabel({ origin, destination: dest })
        : null;

    const base = this.mapRowToListItem(row, etaLabel);
    return {
      ...base,
      foods,
      reviews,
    };
  }

  async create(
    body: {
      name: string;
      description: string;
      address: string;
      phone: string;
      openHours?: string;
      closeHours?: string;
      isActive?: boolean;
    },
    accountId: string,
  ) {
    return this.repo.create({
      EnterpriseName: body.name,
      Description: body.description,
      Address: body.address,
      PhoneNumber: body.phone,
      OpenHours: body.openHours ?? '08:00',
      CloseHours: body.closeHours ?? '22:00',
      IsActive: body.isActive ?? true,
      AccountID: accountId,
    });
  }

  async update(
    id: string,
    body: {
      name?: string;
      description?: string;
      address?: string;
      phone?: string;
      openHours?: string;
      closeHours?: string;
      isOpen?: boolean;
    },
  ) {
    const exists = await this.repo.findById(id);
    if (!exists) {
      throw new NotFoundException('Restaurant not found');
    }
    const data: Prisma.EnterpriseUpdateInput = {};
    if (body.name !== undefined) data.EnterpriseName = body.name;
    if (body.description !== undefined) data.Description = body.description;
    if (body.address !== undefined) data.Address = body.address;
    if (body.phone !== undefined) data.PhoneNumber = body.phone;
    if (body.openHours !== undefined) data.OpenHours = body.openHours;
    if (body.closeHours !== undefined) data.CloseHours = body.closeHours;
    if (body.isOpen !== undefined) data.IsActive = body.isOpen;
    return this.repo.update(id, data);
  }

  async delete(id: string): Promise<{ message: string }> {
    const exists = await this.repo.findById(id);
    if (!exists) {
      throw new NotFoundException('Restaurant not found');
    }
    await this.repo.delete(id);
    return { message: 'Restaurant deleted successfully' };
  }

  async getCommission(enterpriseId: string): Promise<{ success: boolean; commissionFee?: number; error?: string }> {
    const exists = await this.repo.ensureEnterpriseExists(enterpriseId);
    if (!exists) {
      return { success: false, error: 'Restaurant not found' };
    }
    const rate = await this.repo.getCommissionRate(enterpriseId);
    const commissionFee = rate != null ? rate : 0;
    return { success: true, commissionFee };
  }

  async getReviews(
    enterpriseId: string,
    sort: 'newest' | 'oldest' = 'newest',
    page: number = 1,
    limit: number = RestaurantsRepositoryLimits.defaultReviewsLimit,
  ): Promise<RestaurantReviewsResponse> {
    const exists = await this.repo.ensureEnterpriseExists(enterpriseId);
    if (!exists) {
      throw new NotFoundException('Restaurant not found');
    }

    const safeLimit = Math.min(
      Math.max(limit, 1),
      RestaurantsRepositoryLimits.maxPageSize,
    );
    const safePage = Math.max(page, 1);
    const skip = (safePage - 1) * safeLimit;

    const [result, averageRating] = await Promise.all([
      this.repo.findReviewsByEnterprise(enterpriseId, sort, skip, safeLimit),
      this.repo.getAverageRating(enterpriseId),
    ]);

    const reviews = result.reviews.map((r) => ({
      id: r.ReviewID,
      author:
        (r.customer as { account?: { Username?: string } })?.account?.Username ??
        'Anonymous',
      rating: r.Rating ?? 0,
      content: r.Comment ?? '',
      images: Array.isArray(r.Images) ? (r.Images as string[]) : [],
      createdAt: r.CreatedAt.toISOString(),
      updatedAt: r.UpdatedAt?.toISOString() ?? null,
    }));

    return {
      reviews,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: result.total,
        totalPages: Math.ceil(result.total / safeLimit),
      },
      averageRating: Math.round(averageRating * 10) / 10,
      totalReviews: result.total,
    };
  }

  private mapRowToListItem(row: {
    EnterpriseID: string;
    EnterpriseName: string;
    Description: string | null;
    Address: string;
    PhoneNumber: string;
    OpenHours: string;
    CloseHours: string;
    IsActive: boolean;
    CreatedAt: Date;
    UpdatedAt: Date | null;
    Latitude?: unknown;
    Longitude?: unknown;
    account: { Avatar: string | null };
    foods: Array<{
      FoodID: string;
      DishName: string;
      Price: unknown;
      ImageURL: string | null;
      foodCategory: { CategoryName: string };
    }>;
    reviews: Array<{ Rating: number | null }>;
    _count: { foods: number; reviews: number };
  }, etaLabel: string | null): RestaurantListItem {
    const ratings = row.reviews
      .map((r) => r.Rating)
      .filter((r): r is number => r != null);
    const averageRating =
      ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;

    const popularFoods = row.foods.slice(0, 5).map((f) => ({
      foodId: f.FoodID,
      dishName: f.DishName,
      price: Number(f.Price),
      imageUrl: f.ImageURL ?? '',
      category: f.foodCategory.CategoryName,
    }));

    return {
      id: row.EnterpriseID,
      name: row.EnterpriseName,
      description: row.Description ?? '',
      address: row.Address,
      phone: row.PhoneNumber,
      avatarUrl: row.account?.Avatar ?? '',
      rating: Math.round(averageRating * 10) / 10,
      deliveryTime: etaLabel ?? DEFAULT_DELIVERY_TIME,
      minimumOrder: DEFAULT_MINIMUM_ORDER,
      isOpen: row.IsActive,
      openHours: row.OpenHours,
      closeHours: row.CloseHours,
      createdAt: row.CreatedAt,
      updatedAt: row.UpdatedAt ?? row.CreatedAt,
      popularFoods,
      totalFoods: row._count.foods,
      totalReviews: row._count.reviews,
    };
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

  private async resolveDestination(input?: {
    address?: string;
    lat?: number;
    lng?: number;
  }): Promise<LatLng | null> {
    const fromGps = this.toLatLng({ lat: input?.lat, lng: input?.lng });
    if (fromGps) return fromGps;

    const address = (input?.address ?? '').trim();
    if (!address) return null;

    const normalized = this.normalizeAddress(address);
    const key = `geo:fw:vn:${this.sha1(normalized)}`;
    const cached = await getKeyJson<{ lat: number; lng: number }>(key);
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
      return { lat: cached.lat, lng: cached.lng };
    }

    const r = await this.mapbox.forwardGeocode({ address, country: 'VN', limit: 1 });
    if (!r) return null;
    await setKeyJson(key, { lat: r.lat, lng: r.lng }, 30 * 24 * 60 * 60);
    return { lat: r.lat, lng: r.lng };
  }

  private async resolveOriginFromEnterpriseRow(row: {
    Latitude?: unknown;
    Longitude?: unknown;
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

    // Fallback: geocode enterprise address once (cached) so restaurant list can still compute delivery time.
    const address = (row.Address ?? '').trim();
    if (!address) return null;

    const normalized = this.normalizeAddress(address);
    const key = `geo:fw:vn:${this.sha1(normalized)}`;
    const cached = await getKeyJson<{ lat: number; lng: number }>(key);
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
      return { lat: cached.lat, lng: cached.lng };
    }

    const r = await this.mapbox.forwardGeocode({ address, country: 'VN', limit: 1 });
    if (!r) return null;
    await setKeyJson(key, { lat: r.lat, lng: r.lng }, 30 * 24 * 60 * 60);
    return { lat: r.lat, lng: r.lng };
  }

  private roundCoord(n: number): number {
    return Math.round(n * 100000) / 100000;
  }

  private async computeDeliveryTimeLabel(params: {
    origin: LatLng;
    destination: LatLng;
  }): Promise<string | null> {
    const origin = this.toLatLng(params.origin);
    const destination = this.toLatLng(params.destination);
    if (!origin || !destination) return null;

    const o = { lat: this.roundCoord(origin.lat), lng: this.roundCoord(origin.lng) };
    const d = { lat: this.roundCoord(destination.lat), lng: this.roundCoord(destination.lng) };
    const cacheKey = `geo:mx:driving:${o.lng},${o.lat}:${d.lng},${d.lat}`;

    const cached = await getKeyJson<{ durationSeconds: number; distanceMeters?: number }>(cacheKey);
    const durationSeconds =
      cached && typeof cached.durationSeconds === 'number' && Number.isFinite(cached.durationSeconds)
        ? cached.durationSeconds
        : null;
    const cachedDistanceMeters =
      cached && typeof cached.distanceMeters === 'number' && Number.isFinite(cached.distanceMeters)
        ? cached.distanceMeters
        : null;

    const r =
      durationSeconds != null
        ? { durationSeconds, distanceMeters: cachedDistanceMeters ?? 0 }
        : await this.mapbox.matrixDuration({ origin, destination, profile: 'driving' });

    if (!r) return null;
    await setKeyJson(cacheKey, r, DELIVERY_TIME_CACHE_TTL_SECONDS);

    const basePrepMinutesRaw = Number(process.env.ETA_BASE_PREP_MINUTES);
    const basePrepMinutes =
      Number.isFinite(basePrepMinutesRaw) && basePrepMinutesRaw >= 0
        ? Math.round(basePrepMinutesRaw)
        : DEFAULT_BASE_PREP_MINUTES;

    const travelMinutes = Math.max(1, Math.ceil(r.durationSeconds / 60));
    const totalMinutes = basePrepMinutes + travelMinutes;

    const minMinutesRaw = Number(process.env.ETA_MIN_MINUTES);
    const maxMinutesRaw = Number(process.env.ETA_MAX_MINUTES);
    const minMinutes =
      Number.isFinite(minMinutesRaw) && minMinutesRaw > 0
        ? Math.round(minMinutesRaw)
        : DEFAULT_MIN_DELIVERY_MINUTES;
    const maxMinutes =
      Number.isFinite(maxMinutesRaw) && maxMinutesRaw > 0
        ? Math.round(maxMinutesRaw)
        : DEFAULT_MAX_DELIVERY_MINUTES;

    const distanceMeters = Number.isFinite(r.distanceMeters) ? r.distanceMeters : 0;
    if (distanceMeters > 0 && distanceMeters <= 20_000 && totalMinutes > 180) {
      return null;
    }

    const clamped = Math.max(minMinutes, Math.min(maxMinutes, totalMinutes));
    // UI expects a range string like '30-45 min'. Keep a simple +-5min window.
    const lo = Math.max(5, clamped - 5);
    const hi = clamped + 5;
    const label = `${lo}-${hi} min`;
    return label;
  }
}
