import Redis from 'ioredis';
import { env } from '../config/env';
import type { AgentResponse, RequestMode, TestCase } from '../types/type';
import type { AgentResponseSnapshot } from '../../model_payload_test/llm/agentResponseStore';
import { evaluatePayloadWithGpt } from '../../model_payload_test/llm/payloadEvaluator';
import type { DumpedPayload } from '../../model_payload_test/llm/payloadStore';
import { serializePayloadForExternalUse } from '../../model_payload_test/llm/payloadSanitizer';

export interface PayloadAuditResult {
  status: 'FOUND' | 'NOT_APPLICABLE' | 'MISSING';
  dumpedPayload: string;
  prompt: string;
  weatherData: string;
  verdict: string;
  score: number | '';
  expectedIntent: string;
  actualIntent: string;
  checks: string;
  summary: string;
  issues: string;
  error: string;
}

let redis: Redis | undefined;
let connectPromise: Promise<void> | undefined;

export async function auditPayloadForResponse(
  trxId: string,
  accountId: string | undefined,
  group: string,
  tc: TestCase,
  mode: RequestMode,
  data: AgentResponse,
): Promise<PayloadAuditResult> {
  if (data.resultCode !== 200) return emptyResult('NOT_APPLICABLE');

  try {
    const client = await getRedis();
    const payload = await waitForPayload(client, trxId);
    if (!payload) return { ...emptyResult('MISSING'), error: `payload not found for trxId=${trxId}` };

    const dumpedPayload = serializePayloadForExternalUse(payload);
    const snapshot: AgentResponseSnapshot = {
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
    };
    const evaluation = await evaluatePayloadWithGpt(payload, dumpedPayload, snapshot);

    return {
      status: 'FOUND',
      dumpedPayload,
      prompt: payload.prompt ?? '',
      weatherData: payload.weatherData ?? '',
      verdict: evaluation?.verdict ?? '',
      score: evaluation?.score ?? '',
      expectedIntent: evaluation?.expectedIntent ?? '',
      actualIntent: evaluation?.actualIntent ?? '',
      checks: evaluation?.checks.map((check) =>
        `[${check.status}/${check.category}] expected=${check.expected} | actual=${check.actual} | evidence=${check.evidence}`,
      ).join('\n') ?? '',
      summary: evaluation?.summary ?? '',
      issues: evaluation?.issues.map((issue) =>
        `[${issue.severity}/${issue.category}] ${issue.problem} | expected=${issue.expected} | actual=${issue.actual} | evidence=${issue.evidence}`,
      ).join('\n') ?? '',
      error: evaluation?.error ?? '',
    };
  } catch (error) {
    return { ...emptyResult('MISSING'), error: error instanceof Error ? error.message : String(error) };
  }
}

export function closePayloadAudit(): void {
  redis?.disconnect();
  redis = undefined;
  connectPromise = undefined;
}

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

async function waitForPayload(client: Redis, trxId: string): Promise<DumpedPayload | undefined> {
  const streamKey = process.env.WEATHER_ANSWER_COMPARE_STREAM_KEY ?? 'weather:answer-compare';
  const timeoutMs = Number(process.env.GENERAL_PAYLOAD_JOIN_TIMEOUT_MS ?? '15000');
  const deadline = Date.now() + timeoutMs;

  do {
    const rows = await client.xrevrange(streamKey, '+', '-', 'COUNT', 250);
    for (const [, fields] of rows) {
      const index = fields.indexOf('payload');
      if (index < 0 || fields[index + 1] === undefined) continue;
      try {
        const payload = JSON.parse(fields[index + 1]!) as DumpedPayload;
        if (payload.trxId === trxId) return payload;
      } catch {
        // Ignore malformed stream entries.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);

  return undefined;
}

function emptyResult(status: PayloadAuditResult['status']): PayloadAuditResult {
  return {
    status,
    dumpedPayload: '', prompt: '', weatherData: '', verdict: '', score: '',
    expectedIntent: '', actualIntent: '', checks: '', summary: '', issues: '', error: '',
  };
}
