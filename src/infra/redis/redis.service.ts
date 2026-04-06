import Redis from 'ioredis';

const redisConnectionUrl = process.env.REDIS_URL;

if (!redisConnectionUrl) {
  // Do not crash server if Redis is not configured; callers should handle nulls.
  // eslint-disable-next-line no-console
  console.warn(
    '[redis] REDIS_URL is not set in server .env; Redis-backed features will be disabled',
  );
}

export const redisClient = redisConnectionUrl
  ? new Redis(redisConnectionUrl, {
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
  })
  : (null as unknown as Redis);

if (redisConnectionUrl) {
  redisClient.on('error', (err) => {
    console.error('[redis] client error:', err?.message ?? err);
  });
}

export async function getKeyJson<T>(key: string): Promise<T | null> {
  if (!redisClient) return null;
  const raw = await redisClient.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setKeyJson(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  if (!redisClient) return;
  const payload = JSON.stringify(value);
  if (ttlSeconds && ttlSeconds > 0) {
    await redisClient.set(key, payload, 'EX', ttlSeconds);
  } else {
    await redisClient.set(key, payload);
  }
}

export async function deleteKey(key: string): Promise<void> {
  if (!redisClient) return;
  await redisClient.del(key);
}

/**
 * Deletes all keys matching a Redis glob pattern (e.g. `vouchers:approved:list:*`).
 * Uses SCAN to avoid blocking the server on large keyspaces.
 */
export async function deleteKeysMatchingPattern(pattern: string): Promise<void> {
  if (!redisClient) return;
  let cursor = '0';
  do {
    const [next, keys] = await redisClient.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      100,
    );
    cursor = next;
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } while (cursor !== '0');
}

export async function expireKey(
  key: string,
  ttlSeconds: number,
): Promise<void> {
  if (!redisClient) return;
  if (ttlSeconds > 0) {
    await redisClient.expire(key, ttlSeconds);
  }
}

export async function getAllHashJson<T>(
  hashKey: string,
): Promise<Record<string, T>> {
  if (!redisClient) return {};
  const entries = await redisClient.hgetall(hashKey);
  const result: Record<string, T> = {};
  for (const [k, v] of Object.entries(entries)) {
    try {
      result[k] = JSON.parse(v) as T;
    } catch {
      // skip malformed
    }
  }
  return result;
}

