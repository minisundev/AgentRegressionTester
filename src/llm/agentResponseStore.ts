import type Redis from 'ioredis';

export interface AgentResponseSnapshot {
  trxId: string;
  recordedAt: string;
  group: string;
  testcaseId: string | number;
  mode: string;
  accountId: string;
  requestMessage: string;
  resultCode: number;
  response: {
    message: string;
    mainIntent: string;
    subIntent: string;
    entity?: unknown;
    todayCard?: unknown;
    hourlyCard?: unknown;
    weeklyCard?: unknown;
  };
  entityGolden?: {
    status: 'PASS' | 'FAIL' | 'NA';
    expected?: Record<string, unknown> | null;
    differences: Array<{
      path: string;
      expected: unknown;
      actual: unknown;
      problem: string;
    }>;
  };
}

export function getAgentResponseStreamKey(): string {
  return process.env.WEATHER_AGENT_RESPONSE_STREAM_KEY ?? 'weather:agent-response';
}

function getResponseCacheKey(trxId: string): string {
  return `${getAgentResponseStreamKey()}:trx:${trxId}`;
}

export async function storeAgentResponse(
  redis: Redis,
  snapshot: AgentResponseSnapshot,
  ttlSeconds = Number(process.env.AGENT_RESPONSE_CACHE_TTL_SEC ?? '3600'),
): Promise<void> {
  const serialized = JSON.stringify(snapshot);
  await redis.multi()
    .xadd(getAgentResponseStreamKey(), '*', 'response', serialized)
    .set(getResponseCacheKey(snapshot.trxId), serialized, 'EX', ttlSeconds)
    .exec();
}

export async function waitForAgentResponse(
  redis: Redis,
  trxId: string,
  timeoutMs = Number(process.env.AGENT_RESPONSE_JOIN_TIMEOUT_MS ?? '10000'),
): Promise<AgentResponseSnapshot | undefined> {
  if (process.env.JOIN_AGENT_RESPONSE_STREAM !== '1') return undefined;

  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    const raw = await redis.get(getResponseCacheKey(trxId));
    if (raw) {
      try {
        return JSON.parse(raw) as AgentResponseSnapshot;
      } catch {
        return undefined;
      }
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (true);

  return undefined;
}
