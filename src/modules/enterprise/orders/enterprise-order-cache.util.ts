import { deleteKey } from '@infra/redis/redis.service';

const CACHE_KEYS = {
  orders: (enterpriseId: string) => `enterprise:${enterpriseId}:orders:v4`,
  recent: (enterpriseId: string) => `enterprise:${enterpriseId}:recent_orders:v4`,
  stats: (enterpriseId: string) => `enterprise:${enterpriseId}:stats`,
  revenue: (enterpriseId: string) => `enterprise:${enterpriseId}:revenue`,
} as const;

export async function invalidateEnterpriseOrderCaches(
  enterpriseId: string,
): Promise<void> {
  await Promise.all([
    deleteKey(CACHE_KEYS.orders(enterpriseId)),
    deleteKey(CACHE_KEYS.recent(enterpriseId)),
    deleteKey(CACHE_KEYS.stats(enterpriseId)),
    deleteKey(CACHE_KEYS.revenue(enterpriseId)),
  ]);
}

