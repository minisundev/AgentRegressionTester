import Redis from 'ioredis';

let client: InstanceType<typeof Redis>;

function getClient(): InstanceType<typeof Redis> {
  if (!client) {
    client = new Redis({
      host: process.env.REDIS_ENDPOINT,
      port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
      password: process.env.REDIS_PASSWD?.trim() || undefined,
      tls: process.env.REDIS_SSL === 'true' ? {} : undefined,
    });
  }
  return client;
}

export async function mset(values: Record<string, string>): Promise<void> {
  await getClient().mset(values);
}

export async function delByPattern(pattern: string, keep: string[] = []): Promise<number> {
  const redis = getClient();
  const keepSet = new Set(keep);
  let deletedCount = 0;
  let cursor = '0';

  do {
    const reply = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = reply[0];
    const keys = reply[1].filter((k: string) => !keepSet.has(k));
    if (keys.length > 0) {
      deletedCount += await redis.del(...keys);
    }
  } while (cursor !== '0');

  return deletedCount;
}
