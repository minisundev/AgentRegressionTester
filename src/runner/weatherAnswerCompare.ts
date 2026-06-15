/**
 * Weather answer payload stream consumer.
 *
 * Consumes answer payloads published to Redis Stream, fans each payload out to
 * GemmaProd, GPT-5.4, and Gemini, then prints or appends the comparison row.
 */

import { callGemini, callGemmaProd, callGpt54 } from '../llm/clients.js';
import { ensureWatcherEnv } from '../llm/env.js';
import {
  ackPayload,
  ensurePayloadStreamGroup,
  getPayloadStreamConfig,
  readNewPayloads,
  readPendingPayloads,
  type DumpedPayload,
} from '../llm/payloadStore.js';
import { createRedisClient } from '../llm/redis.js';
import { appendAnswerCompareToSheet } from '../llm/sheets.js';
import type { AnswerCompareRow } from '../types/answerCompare.js';

ensureWatcherEnv();

const REPORT_TO = process.env.REPORT_TO ?? 'terminal';
const READ_EXISTING = process.env.READ_EXISTING_PAYLOADS === '1';
const STREAM_BLOCK_MS = Number(process.env.STREAM_BLOCK_MS ?? '5000');
const PENDING_RETRY_INTERVAL_MS = Number(process.env.PENDING_RETRY_INTERVAL_MS ?? '30000');

function inferGroup(subIntent: string): string {
  switch (subIntent) {
    case 'CheckDailyForecast':
      return 'DailyForecast';
    case 'CheckHourlyForecast':
      return 'HourlyForecast';
    case 'CheckTemperature':
      return 'Temperature';
    case 'CheckAirQuality':
      return 'AirQuality';
    case 'CheckWeeklyForecast':
      return 'WeeklyForecast';
    default:
      return subIntent || 'Unknown';
  }
}

async function compareOne(payload: DumpedPayload): Promise<AnswerCompareRow> {
  const [gemma, gpt54, gemini] = await Promise.all([
    callGemmaProd(payload),
    callGpt54(payload),
    callGemini(payload),
  ]);

  return {
    testedAt: new Date().toISOString(),
    group: inferGroup(payload.subIntent),
    id: payload.trxId,
    message: payload.userMessage,
    subIntent: payload.subIntent,
    language: payload.language,
    weatherDataPayload: payload.weatherData,
    userMessage: payload.userMessage,
    gemmaProdModel: gemma.model,
    gemmaProdResponse: gemma.response,
    gemmaProdLatency: gemma.latency,
    gemmaProdError: gemma.error ?? '',
    gpt54Model: gpt54.model,
    gpt54Response: gpt54.response,
    gpt54Latency: gpt54.latency,
    gpt54Error: gpt54.error ?? '',
    geminiModel: gemini.model,
    geminiResponse: gemini.response,
    geminiLatency: gemini.latency,
    geminiError: gemini.error ?? '',
    serviceResponse: '',
  };
}

async function emitRow(row: AnswerCompareRow): Promise<void> {
  console.log(
    `[compare] ${row.subIntent} trxId=${row.id} gemma=${row.gemmaProdLatency}ms gpt54=${row.gpt54Latency}ms gemini=${row.geminiLatency}ms`,
  );

  if (REPORT_TO === 'sheet') {
    await appendAnswerCompareToSheet([row]);
  }
}

async function main(): Promise<void> {
  const { streamKey, group, consumer } = getPayloadStreamConfig();
  const redis = createRedisClient();

  await redis.connect();
  await ensurePayloadStreamGroup(redis, READ_EXISTING);

  console.log(`[watcher] stream key: ${streamKey}`);
  console.log(`[watcher] group: ${group}`);
  console.log(`[watcher] consumer: ${consumer}`);
  console.log(`[watcher] report to: ${REPORT_TO}`);
  console.log(`[watcher] stream block: ${STREAM_BLOCK_MS}ms`);
  console.log(`[watcher] pending retry interval: ${PENDING_RETRY_INTERVAL_MS}ms`);
  console.log(`[watcher] read existing payloads: ${READ_EXISTING ? 'yes' : 'no'} (group start)`);

  let lastPendingRetryAt = 0;

  try {
    for (;;) {
      const now = Date.now();
      const shouldRetryPending = now - lastPendingRetryAt >= PENDING_RETRY_INTERVAL_MS;
      const pendingEntries = shouldRetryPending
        ? await readPendingPayloads(redis, 10)
        : [];

      if (shouldRetryPending) {
        lastPendingRetryAt = now;
      }

      const entries = pendingEntries.length > 0
        ? pendingEntries
        : await readNewPayloads(redis, 10, STREAM_BLOCK_MS);

      for (const entry of entries) {
        const payload = entry.payload;

        try {
          const row = await compareOne(payload);
          await emitRow(row);
          await ackPayload(redis, entry.streamId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[watcher] failed trxId=${payload.trxId} streamId=${entry.streamId}: ${message}`);
        }
      }
    }
  } finally {
    redis.disconnect();
  }
}

main().catch((error) => {
  console.error(`[watcher] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
