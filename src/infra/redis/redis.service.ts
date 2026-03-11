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

