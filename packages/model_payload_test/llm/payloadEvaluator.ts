import { z } from 'zod';
import { PAYLOAD_JUDGE_PROMPT } from '../config/payloadJudgePrompt.js';
import type { PayloadEvaluationResult } from '../types/answerCompare.js';
import { callGpt } from './clients.js';
import type { DumpedPayload } from './payloadStore.js';
import type { AgentResponseSnapshot } from './agentResponseStore.js';

const PAYLOAD_EVALUATION_MAX_TOKENS = 3000;

const CategorySchema = z.enum([
  'INTENT_ROUTING',
  'ENTITY_EXTRACTION',
  'DATA_SCOPE',
  'CARD_SELECTION',
  'CARD_CONTENT',
  'TIME_OF_DAY_MAPPING',
  'NEXT_TIME_FALLBACK',
  'RANGE_CLAMPING',
  'MULTI_TURN_INHERITANCE',
  'CROSS_STAGE_CONSISTENCY',
]);

const PayloadEvaluationSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'borderline', 'not_evaluable']),
  score: z.number().min(0).max(100),
  expectedIntent: z.enum([
    'CheckHourlyForecast',
    'CheckDailyForecast',
    'CheckWeeklyForecast',
    'unknown',
  ]),
  actualIntent: z.string(),
  checks: z.array(z.object({
    category: CategorySchema,
    status: z.enum(['PASS', 'FAIL', 'BORDERLINE', 'NA']),
    expected: z.string(),
    actual: z.string(),
    evidence: z.string(),
  })),
  summary: z.string(),
  issues: z.array(z.object({
    category: CategorySchema,
    severity: z.enum(['critical', 'major', 'minor']),
    problem: z.string(),
    expected: z.string(),
    actual: z.string(),
    evidence: z.string(),
  })),
});

export function isPayloadEvaluationEnabled(): boolean {
  return process.env.EVALUATE_PAYLOAD_WITH_GPT === '1';
}

function getJudgeLlmId(): number | undefined {
  const parsed = Number(process.env.GPT_JUDGE_LLM_ID ?? process.env.GPT_TEST_LLM_ID);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function getOriginalUserQuery(payload: DumpedPayload): string {
  const weatherData = parseJson(payload.weatherData);
  if (weatherData && typeof weatherData === 'object' && !Array.isArray(weatherData)) {
    const requestMessage = (weatherData as Record<string, unknown>).requestMessage;
    if (typeof requestMessage === 'string' && requestMessage.trim()) return requestMessage.trim();
  }

  return payload.userMessage.split(/\n+## WEATHER DATA\b/i)[0]?.trim() || payload.userMessage;
}

function buildJudgeInput(
  payload: DumpedPayload,
  rawPayload: string,
  agentResponse?: AgentResponseSnapshot,
): string {
  let parsedPayload: unknown = rawPayload;
  try {
    parsedPayload = JSON.parse(rawPayload);
  } catch {
    // Preserve malformed/raw input so the judge can report limited observability.
  }

  return JSON.stringify({
    userQuery: getOriginalUserQuery(payload),
    llmUserMessage: payload.userMessage,
    topLevelSubIntent: payload.subIntent,
    topLevelMainIntent: payload.mainIntent,
    language: payload.language,
    rawDumpedPayload: parsedPayload,
    agentApiResponse: agentResponse ?? null,
  }, null, 2);
}

function errorResult(error: string, latency: number): PayloadEvaluationResult {
  return {
    verdict: 'not_evaluable',
    score: 0,
    expectedIntent: 'unknown',
    actualIntent: '',
    checks: [],
    summary: '',
    issues: [],
    error,
    latency,
  };
}

export async function evaluatePayloadWithGpt(
  payload: DumpedPayload,
  rawPayload: string,
  agentResponse?: AgentResponseSnapshot,
): Promise<PayloadEvaluationResult | undefined> {
  if (!isPayloadEvaluationEnabled()) return undefined;

  const start = Date.now();
  const judgePayload: DumpedPayload = {
    ...payload,
    prompt: PAYLOAD_JUDGE_PROMPT,
    userMessage: buildJudgeInput(payload, rawPayload, agentResponse),
    llmParams: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: PAYLOAD_EVALUATION_MAX_TOKENS,
      responseFormat: 'json_object',
    },
  };

  const judge = await callGpt(judgePayload, { llmId: getJudgeLlmId(), temperature: 0 });
  if (judge.error) return errorResult(judge.error, Date.now() - start);

  try {
    const result = PayloadEvaluationSchema.parse(JSON.parse(extractJsonObject(judge.response)));
    return { ...result, latency: Date.now() - start };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(
      `payload judge parse failed: ${message}; raw=${judge.response.slice(0, 500)}`,
      Date.now() - start,
    );
  }
}
