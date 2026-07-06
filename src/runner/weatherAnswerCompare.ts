/**
 * Weather answer payload stream consumer.
 *
 * Consumes answer payloads published to Redis Stream, fans each payload out to
 * the cases configured in src/config/answerCompare.yaml (GPT + a Gemini
 * temperature sweep, etc.), then prints or appends the comparison row.
 */

import { runCompareCase } from '../llm/clients.js';
import { loadCompareCases } from '../config/answerCompareConfig.js';
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
import { evaluateCompareResults } from '../llm/evaluator.js';
import { evaluatePayloadWithGpt, getOriginalUserQuery } from '../llm/payloadEvaluator.js';
import { serializePayloadForExternalUse } from '../llm/payloadSanitizer.js';
import { waitForAgentResponse } from '../llm/agentResponseStore.js';
import type { AnswerCompareRow, AnswerModelResult } from '../types/answerCompare.js';

ensureWatcherEnv();

const CASES = loadCompareCases();

const REPORT_TO = process.env.ANSWER_COMPARE_REPORT_TO ?? process.env.REPORT_TO ?? 'terminal';
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

async function compareOne(
  payload: DumpedPayload,
  redis: ReturnType<typeof createRedisClient>,
): Promise<AnswerCompareRow> {
  const reportPayload = serializePayloadForExternalUse(payload);
  const resultsPromise = Promise.all(CASES.map((c) => runCompareCase(payload, c)));
  const agentResponse = await waitForAgentResponse(redis, payload.trxId);
  const payloadEvaluationPromise = evaluatePayloadWithGpt(payload, reportPayload, agentResponse);
  const results = await resultsPromise;

  const resultMap: Record<string, AnswerModelResult> = {};
  CASES.forEach((c, i) => {
    resultMap[c.key] = results[i]!;
  });

  const [evaluations, payloadEvaluation] = await Promise.all([
    evaluateCompareResults(payload, CASES, resultMap),
    payloadEvaluationPromise,
  ]);

  return {
    testedAt: new Date().toISOString(),
    group: inferGroup(payload.subIntent),
    id: payload.trxId,
    message: getOriginalUserQuery(payload),
    subIntent: payload.subIntent,
    language: payload.language,
    weatherDataPayload: payload.weatherData,
    userMessage: payload.userMessage,
    dumpedPayload: reportPayload,
    prompt: payload.prompt,
    agentResponse,
    results: resultMap,
    evaluations,
    payloadEvaluation,
    serviceResponse: agentResponse?.response.message ?? '',
  };
}

async function emitRow(row: AnswerCompareRow): Promise<void> {
  const summary = CASES.map((c) => `${c.key}=${row.results[c.key]?.latency ?? '-'}ms`).join(' ');
  const evaluationSummary = row.evaluations
    ? ` judge=${Object.values(row.evaluations)
      .filter((evaluation) => evaluation.verdict !== 'pass')
      .map((evaluation) => evaluation.verdict)
      .join(',') || 'pass'}`
    : '';
  const payloadSummary = row.payloadEvaluation
    ? ` payloadJudge=${row.payloadEvaluation.verdict}:${row.payloadEvaluation.score}`
    : '';
  const joinSummary = row.agentResponse ? ' joined=api+payload' : ' joined=payload-only';
  console.log(`[compare] ${row.subIntent} trxId=${row.id} ${summary}${evaluationSummary}${payloadSummary}${joinSummary}`);

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
          const row = await compareOne(payload, redis);
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
