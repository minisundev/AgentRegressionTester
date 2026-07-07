import Redis from 'ioredis';
import { env } from '../config/env';
import type { AgentResponse, RequestMode, TestCase } from '../types/type';
import { storeAgentResponse } from '../../model_payload_test/llm/agentResponseStore';
import type { EntityGoldenResult } from './entityGolden';

let redis: Redis | undefined;
let connectPromise: Promise<void> | undefined;

async function getRedis(): Promise<Redis> {
  if (!redis) {
    redis = env.REDIS_URL
      ? new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
      : new Redis({
          host: env.REDIS_ENDPOINT ?? '127.0.0.1',
          port: Number(env.REDIS_PORT ?? '6379'),
          password: env.REDIS_PASSWD?.trim() || undefined,
          tls: env.REDIS_SSL === 'true' ? {} : undefined,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });
    connectPromise = redis.connect();
  }
  await connectPromise;
  return redis;
}

export async function publishAgentResponse(
  trxId: string,
  accountId: string | undefined,
  group: string,
  tc: TestCase,
  mode: RequestMode,
  data: AgentResponse,
  entityGolden: EntityGoldenResult,
): Promise<void> {
  if (env.PUBLISH_AGENT_RESPONSE_STREAM !== '1') return;

  try {
    const client = await getRedis();
    await storeAgentResponse(client, {
      trxId,
      recordedAt: new Date().toISOString(),
      group,
      testcaseId: tc.id,
      mode,
      accountId: accountId ?? '',
      requestMessage: data.requestMessage,
      resultCode: data.resultCode,
      response: {
        message: data.response.message,
        mainIntent: data.response.mainIntent,
        subIntent: data.response.subIntent,
        entity: data.response.entity,
        todayCard: data.response.todayCard,
        hourlyCard: data.response.hourlyCard,
        weeklyCard: data.response.weeklyCard,
      },
      entityGolden,
    });
  } catch (error) {
    console.warn(`[response-stream] publish failed trxId=${trxId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function closeAgentResponsePublisher(): void {
  redis?.disconnect();
  redis = undefined;
  connectPromise = undefined;
}
