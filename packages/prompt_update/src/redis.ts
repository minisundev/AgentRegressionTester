import Redis from 'ioredis';

let client: InstanceType<typeof Redis>;

export function getClient(): InstanceType<typeof Redis> {
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
