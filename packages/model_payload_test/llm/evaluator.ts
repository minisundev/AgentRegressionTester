import { z } from 'zod';
import type {
  AnswerEvaluationResult,
  AnswerModelResult,
  CompareCase,
  EvaluationCategory,
  EvaluationVerdict,
} from '../types/answerCompare.js';
import { callGpt } from './clients.js';
import type { DumpedPayload } from './payloadStore.js';

const EVALUATION_MAX_TOKENS = 1600;

const CategorySchema = z.enum([
  'DATA_FIDELITY',
  'TEMPORAL_ALIGNMENT',
  'SUMMARY_AGGREGATION',
  'UNSUPPORTED_INFERENCE',
  'ADVICE_POLICY',
  'AVAILABILITY_HANDLING',
  'FIELD_MAPPING',
]);

const EvaluationSchema = z.object({
  verdict: z.enum(['pass', 'fail', 'borderline']),
  score: z.number().min(0).max(100),
  categories: z.array(CategorySchema),
  summary: z.string(),
  issues: z.array(z.object({
    category: CategorySchema,
    severity: z.enum(['critical', 'major', 'minor']),
    quote: z.string(),
    problem: z.string(),
    evidence: z.string(),
  })),
});

function isEvaluationEnabled(): boolean {
  return process.env.EVALUATE_WITH_GPT === '1';
}

function getJudgeLlmId(): number | undefined {
  const raw = process.env.GPT_JUDGE_LLM_ID ?? process.env.GPT_TEST_LLM_ID;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getEvaluatedCaseKeys(): Set<string> | null {
  const raw = process.env.EVALUATE_CASE_KEYS;
  if (!raw) return null;

  const keys = raw.split(',').map((key) => key.trim()).filter(Boolean);
  return keys.length > 0 ? new Set(keys) : null;
}

function shouldEvaluateCase(c: CompareCase, result: AnswerModelResult, selectedKeys: Set<string> | null): boolean {
  if (!isEvaluationEnabled()) return false;
  if (selectedKeys && !selectedKeys.has(c.key)) return false;
  return Boolean(result.response.trim()) && !result.error;
}

function buildEvaluationPrompt(): string {
  return [
    'You are a strict weather-answer judge. Evaluate whether the candidate answer is faithful to the provided weather data and user question.',
    '',
    'Important allowance:',
    '- A short practical weather advice sentence is allowed, but it must not introduce unsupported dates, times, numbers, weather events, or safety claims.',
    '',
    'Evaluate these categories:',
    '1. DATA_FIDELITY: every date, time, number, weather condition, air-quality value, and location in the answer must match the data. Do not allow invented values.',
    '2. TEMPORAL_ALIGNMENT: relative labels such as hôm nay, ngày mai, ngày kia, cuối tuần, thứ Sáu must follow the data date/time. The model must not recalculate relative dates against its own clock.',
    '3. SUMMARY_AGGREGATION: ranges and summaries must cover the actual data. Do not clip outliers, flatten 99/97/58 to 100, call a non-monotonic sequence monotonic, or answer an average question with only min-max range.',
    '4. UNSUPPORTED_INFERENCE: mark unsupported claims when the answer infers something not available from the data, including rain duration, all-day rain, unseen hours, or unavailable future/past data.',
    '5. ADVICE_POLICY: advice must be grounded in the data. Negative air quality (xấu/rất xấu or bad PM indicators) should be mentioned when present and relevant, even if the user asks a narrow weather metric.',
    '6. AVAILABILITY_HANDLING: if data is null, empty, requestedUnavailablePast, requestedBeyondForecastLimit, or a requested metric is missing, the answer must say the data is unavailable instead of fabricating it.',
    '7. FIELD_MAPPING: do not map labels to the wrong field, e.g. saying PM2.5/PM10 are good/bad when only another dust category supports that label.',
    '',
    'Return JSON only, no markdown. Schema:',
    '{',
    '  "verdict": "pass" | "fail" | "borderline",',
    '  "score": number from 0 to 100,',
    '  "categories": ["DATA_FIDELITY" | "TEMPORAL_ALIGNMENT" | "SUMMARY_AGGREGATION" | "UNSUPPORTED_INFERENCE" | "ADVICE_POLICY" | "AVAILABILITY_HANDLING" | "FIELD_MAPPING"],',
    '  "summary": "Korean one-sentence result. Include the wrong t/candidate label if failed.",',
    '  "issues": [{',
    '    "category": "one category",',
    '    "severity": "critical" | "major" | "minor",',
    '    "quote": "short exact quote from candidate answer",',
    '    "problem": "Korean explanation of what is wrong",',
    '    "evidence": "specific source data value/date/time proving it"',
    '  }]',
    '}',
    '',
    'Verdict guide:',
    '- fail: wrong date/time/number, fabricated unavailable data, wrong aggregation, or materially unsafe omission.',
    '- borderline: values are faithful but wording, advice, mapping, or priority is questionable.',
    '- pass: faithful enough; harmless advice is allowed.',
  ].join('\n');
}

function buildEvaluationUserMessage(payload: DumpedPayload, c: CompareCase, result: AnswerModelResult): string {
  return JSON.stringify({
    candidateKey: c.key,
    candidateLabel: c.label,
    question: payload.userMessage,
    subIntent: payload.subIntent,
    language: payload.language,
    weatherData: safeJsonParse(payload.weatherData),
    candidateAnswer: result.response,
  }, null, 2);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function normalizeEvaluation(parsed: z.infer<typeof EvaluationSchema>): AnswerEvaluationResult {
  const categories = parsed.categories as EvaluationCategory[];
  const verdict = parsed.verdict as EvaluationVerdict;

  return {
    verdict,
    score: parsed.score,
    categories,
    summary: parsed.summary,
    issues: parsed.issues.map((issue) => ({
      category: issue.category as EvaluationCategory,
      severity: issue.severity,
      quote: issue.quote,
      problem: issue.problem,
      evidence: issue.evidence,
    })),
  };
}

export async function evaluateAnswerWithGpt(
  payload: DumpedPayload,
  c: CompareCase,
  result: AnswerModelResult,
): Promise<AnswerEvaluationResult> {
  const start = Date.now();
  const judgePayload: DumpedPayload = {
    ...payload,
    prompt: buildEvaluationPrompt(),
    userMessage: buildEvaluationUserMessage(payload, c, result),
    llmParams: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: EVALUATION_MAX_TOKENS,
      responseFormat: 'json_object',
    },
  };

  const judge = await callGpt(judgePayload, { llmId: getJudgeLlmId(), temperature: 0 });
  if (judge.error) {
    return {
      verdict: 'borderline',
      score: 0,
      categories: [],
      summary: '',
      issues: [],
      error: judge.error,
      latency: Date.now() - start,
    };
  }

  try {
    const parsed = EvaluationSchema.parse(JSON.parse(extractJsonObject(judge.response)));
    return {
      ...normalizeEvaluation(parsed),
      latency: Date.now() - start,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      verdict: 'borderline',
      score: 0,
      categories: [],
      summary: '',
      issues: [],
      error: `judge parse failed: ${message}; raw=${judge.response.slice(0, 500)}`,
      latency: Date.now() - start,
    };
  }
}

export async function evaluateCompareResults(
  payload: DumpedPayload,
  cases: CompareCase[],
  results: Record<string, AnswerModelResult>,
): Promise<Record<string, AnswerEvaluationResult> | undefined> {
  if (!isEvaluationEnabled()) return undefined;

  const selectedKeys = getEvaluatedCaseKeys();
  const entries = await Promise.all(cases.map(async (c) => {
    const result = results[c.key];
    if (!result || !shouldEvaluateCase(c, result, selectedKeys)) return null;
    const evaluation = await evaluateAnswerWithGpt(payload, c, result);
    return [c.key, evaluation] as const;
  }));

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, AnswerEvaluationResult] => entry !== null));
}
