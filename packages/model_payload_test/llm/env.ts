import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

let loaded = false;

export function ensureWatcherEnv(): void {
  if (loaded) return;

  loadDotenv();

  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv) {
    loadDotenv({
      path: path.resolve(process.cwd(), `.env.${nodeEnv}`),
      override: false,
    });
  }

  if (!process.env.REDIS_ENDPOINT && process.env.REDIS_URL) {
    try {
      const redisUrl = new URL(process.env.REDIS_URL);
      process.env.REDIS_ENDPOINT = redisUrl.hostname;
      process.env.REDIS_PORT = redisUrl.port || '6379';
      process.env.REDIS_SSL = redisUrl.protocol === 'rediss:' ? 'true' : 'false';
      if (!process.env.REDIS_PASSWD && redisUrl.password) {
        process.env.REDIS_PASSWD = redisUrl.password;
      }
    } catch {
      /* ignore malformed REDIS_URL */
    }
  }

  loaded = true;
}
