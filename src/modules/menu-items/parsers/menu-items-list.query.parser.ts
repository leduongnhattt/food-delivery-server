import type { MenuItemsListQueryDto } from '@modules/menu-items/dto/menu-items.dto';
import type { MenuItemsListFilterInput } from '@infra/repositories/menu-items.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface ParsedMenuItemsListQuery {
  page: number;
  limit: number;
  skip: number;
  filters: MenuItemsListFilterInput;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) {
    return fallback;
  }
  return n;
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(limit, 1), MAX_LIMIT);
}

/**
 * Normalizes list query params to match legacy Next.js `/api/menu-items` behavior:
 * - `isAvailable` filter applies only when the query key is sent (including empty string → false).
 */
export function parseMenuItemsListQuery(
  query: MenuItemsListQueryDto,
): ParsedMenuItemsListQuery {
  const page = parsePositiveInt(query.page, DEFAULT_PAGE);
  const limit = clampLimit(parsePositiveInt(query.limit, DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  const filters: MenuItemsListFilterInput = {};

  const restaurantId = query.restaurantId?.trim();
  if (restaurantId) {
    filters.restaurantId = restaurantId;
  }

  const category = query.category?.trim();
  if (category) {
    filters.category = category;
  }

  const search = query.search?.trim();
  if (search) {
    filters.search = search;
  }

  if (query.isAvailable !== undefined) {
    filters.isAvailable = query.isAvailable === 'true';
  }

  return { page, limit, skip, filters };
}
