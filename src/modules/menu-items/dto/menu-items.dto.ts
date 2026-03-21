import type { MenuItemListRow } from '@infra/repositories/menu-items.repository';

/** Raw query object from `@Query()` (all values are strings when present). */
export interface MenuItemsListQueryDto {
  restaurantId?: string;
  category?: string;
  search?: string;
  isAvailable?: string;
  page?: string;
  limit?: string;
}

export interface CreateMenuItemBodyDto {
  name?: string;
  description?: string;
  price?: number | string;
  image?: string | null;
  category?: string;
  isAvailable?: boolean;
  restaurantId?: string;
}

export interface UpdateMenuItemBodyDto {
  name?: string;
  description?: string;
  price?: number | string;
  image?: string | null;
  isAvailable?: boolean;
}

export interface MenuItemsListResponseDto {
  menuItems: MenuItemListRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
