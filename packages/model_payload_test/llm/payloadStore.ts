import type Redis from 'ioredis';
import type { LLMEndpointConfig, LLMParams } from '../types/llm.js';

export interface DumpedPayload {
  trxId: string;
  mainIntent: string;
  subIntent: string;
  language: string;
  prompt: string;
  llmParams: LLMParams;
  connectionConfig: LLMEndpointConfig;
  userMessage: string;
  weatherData: string;
}

export interface StreamPayloadEntry {
  streamId: string;
  rawPayload: string;
  payload: DumpedPayload;
}

type StreamResponse = Array<[string, Array<[string, string[]]>]>;

function getStreamKey(): string {
  return process.env.WEATHER_ANSWER_COMPARE_STREAM_KEY ?? 'weather:answer-compare';
}

function getStreamGroup(): string {
  return process.env.WEATHER_ANSWER_COMPARE_STREAM_GROUP ?? 'weather-answer-compare';
}

function getStreamConsumer(): string {
  return process.env.WEATHER_ANSWER_COMPARE_STREAM_CONSUMER ?? 'watcher-1';
}

function parseEntries(response: StreamResponse | null): StreamPayloadEntry[] {
  if (!response) return [];

  return response.flatMap(([, messages]) =>
    messages.flatMap(([streamId, fields]) => {
      const map = new Map<string, string>();
      for (let i = 0; i < fields.length; i += 2) {
        const fieldName = fields[i];
        const fieldValue = fields[i + 1];
        if (fieldName !== undefined && fieldValue !== undefined) {
          map.set(fieldName, fieldValue);
        }
      }

      const rawPayload = map.get('payload');
      if (!rawPayload) return [];

      try {
        return [{
          streamId,
          rawPayload,
          payload: JSON.parse(rawPayload) as DumpedPayload,
        }];
      } catch {
        return [];
      }
    }),
  );
}

export async function ensurePayloadStreamGroup(redis: Redis, readExisting = false): Promise<void> {
  const streamKey = getStreamKey();
  const group = getStreamGroup();
  const startId = readExisting ? '0' : '$';

  try {
    await redis.xgroup('CREATE', streamKey, group, startId, 'MKSTREAM');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('BUSYGROUP')) {
      throw error;
    }
  }
}

export async function readPendingPayloads(
  redis: Redis,
  count = 10,
): Promise<StreamPayloadEntry[]> {
  const response = await redis.xreadgroup(
    'GROUP',
    getStreamGroup(),
    getStreamConsumer(),
    'COUNT',
    count,
    'STREAMS',
    getStreamKey(),
    '0',
  ) as StreamResponse | null;

  return parseEntries(response);
}

export async function readNewPayloads(
  redis: Redis,
  count = 10,
  blockMs = 5000,
): Promise<StreamPayloadEntry[]> {
  const response = await redis.xreadgroup(
    'GROUP',
    getStreamGroup(),
    getStreamConsumer(),
    'COUNT',
    count,
    'BLOCK',
    blockMs,
    'STREAMS',
    getStreamKey(),
    '>',
  ) as StreamResponse | null;

  return parseEntries(response);
}

export async function ackPayload(redis: Redis, streamId: string): Promise<void> {
  await redis.xack(getStreamKey(), getStreamGroup(), streamId);
}

export function getPayloadStreamConfig() {
  return {
    streamKey: getStreamKey(),
    group: getStreamGroup(),
    consumer: getStreamConsumer(),
  };
}
