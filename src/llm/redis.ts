import Redis from 'ioredis';
import type { LLMEndpointConfig } from '../types/llm.js';
import { ensureWatcherEnv } from './env.js';

export function createRedisClient(): Redis {
  ensureWatcherEnv();

  if (process.env.REDIS_URL) {
    return new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  return new Redis({
    host: process.env.REDIS_ENDPOINT ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWD?.trim() || undefined,
    tls: process.env.REDIS_SSL === 'true' ? {} : undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

export async function getLlmConfigFromRedis(id: number): Promise<LLMEndpointConfig | undefined> {
  const client = createRedisClient();

  try {
    await client.connect();
    const raw = await client.get(`config:llm:${id}`);
    if (!raw) return undefined;
    return JSON.parse(raw) as LLMEndpointConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[redis] failed to load config:llm:${id}: ${message}`);
    return undefined;
  } finally {
    client.disconnect();
  }
}
