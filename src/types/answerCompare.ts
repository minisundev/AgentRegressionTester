export interface AnswerModelResult {
  model: string;
  response: string;
  latency: number;
  error?: string;
}

export type EvaluationVerdict = 'pass' | 'fail' | 'borderline';

export type EvaluationCategory =
  | 'DATA_FIDELITY'
  | 'TEMPORAL_ALIGNMENT'
  | 'SUMMARY_AGGREGATION'
  | 'UNSUPPORTED_INFERENCE'
  | 'ADVICE_POLICY'
  | 'AVAILABILITY_HANDLING'
  | 'FIELD_MAPPING';

export interface AnswerEvaluationIssue {
  category: EvaluationCategory;
  severity: 'critical' | 'major' | 'minor';
  quote: string;
  problem: string;
  evidence: string;
}

export interface AnswerEvaluationResult {
  verdict: EvaluationVerdict;
  score: number;
  categories: EvaluationCategory[];
  summary: string;
  issues: AnswerEvaluationIssue[];
  error?: string;
  latency?: number;
}

export type PayloadEvaluationCategory =
  | 'INTENT_ROUTING'
  | 'ENTITY_EXTRACTION'
  | 'DATA_SCOPE'
  | 'CARD_SELECTION'
  | 'CARD_CONTENT'
  | 'TIME_OF_DAY_MAPPING'
  | 'NEXT_TIME_FALLBACK'
  | 'RANGE_CLAMPING'
  | 'MULTI_TURN_INHERITANCE'
  | 'CROSS_STAGE_CONSISTENCY';

export interface PayloadEvaluationCheck {
  category: PayloadEvaluationCategory;
  status: 'PASS' | 'FAIL' | 'BORDERLINE' | 'NA';
  expected: string;
  actual: string;
  evidence: string;
}

export interface PayloadEvaluationIssue {
  category: PayloadEvaluationCategory;
  severity: 'critical' | 'major' | 'minor';
  problem: string;
  expected: string;
  actual: string;
  evidence: string;
}

export interface PayloadEvaluationResult {
  verdict: 'pass' | 'fail' | 'borderline' | 'not_evaluable';
  score: number;
  expectedIntent: 'CheckHourlyForecast' | 'CheckDailyForecast' | 'CheckWeeklyForecast' | 'unknown';
  actualIntent: string;
  checks: PayloadEvaluationCheck[];
  summary: string;
  issues: PayloadEvaluationIssue[];
  error?: string;
  latency?: number;
}

export type CompareProvider = 'gpt' | 'gemini' | 'gemma';

/** Runtime knobs handed to a provider client. */
export interface CompareCaseParams {
  provider: CompareProvider;
  /** Redis config:llm:<id> to load the endpoint + auth from. */
  llmId?: number;
  /** Sampling temperature (sweep axis). GPT-5 ignores this. */
  temperature?: number;
  /** Gemini reasoning level: minimal | low | high. */
  thinkingLevel?: string;
}

/** A single comparison column group, as defined in answerCompare.yaml. */
export interface CompareCase extends CompareCaseParams {
  /** Stable id, used to key results. */
  key: string;
  /** Sheet column-group label, e.g. "Gemini t0.3". */
  label: string;
}

export interface AnswerCompareRow {
  testedAt: string;
  group: string;
  id: string | number;
  message: string;
  subIntent: string;
  language: string;
  weatherDataPayload: string;
  userMessage: string;
  /** Redis payload JSON with credential-like fields redacted. */
  dumpedPayload: string;
  prompt: string;
  agentResponse?: import('../llm/agentResponseStore.js').AgentResponseSnapshot;
  /** Per-case results, keyed by CompareCase.key. */
  results: Record<string, AnswerModelResult>;
  /** Per-case GPT judge results, keyed by CompareCase.key. */
  evaluations?: Record<string, AnswerEvaluationResult>;
  payloadEvaluation?: PayloadEvaluationResult;
  serviceResponse: string;
}

/** One sheet column: either a value pulled from the row, or a GOOGLETRANSLATE of another column. */
export interface CompareColumn {
  header: string;
  /** Value getter for a normal column. */
  getValue?: (row: AnswerCompareRow) => string | number;
  /** If set, this column is a GOOGLETRANSLATE of the column with this header. */
  translateOf?: string;
}

/**
 * Build the ordered sheet columns from the configured cases. Layout:
 *   meta... | (per case: Model, Response, Response Translation, Latency, Error) | Service...
 */
export function buildCompareColumns(cases: CompareCase[]): CompareColumn[] {
  const columns: CompareColumn[] = [
    { header: 'Tested At', getValue: (r) => r.testedAt },
    { header: 'Group', getValue: (r) => r.group },
    { header: 'ID', getValue: (r) => r.id },
    { header: 'Message', getValue: (r) => r.message },
    { header: 'Message Translation', translateOf: 'Message' },
    { header: 'SubIntent', getValue: (r) => r.subIntent },
    { header: 'Language', getValue: (r) => r.language },
    { header: 'Weather Data', getValue: (r) => r.weatherDataPayload },
    { header: 'User Message', getValue: (r) => r.userMessage },
  ];

  for (const c of cases) {
    columns.push(
      { header: `${c.label} Model`, getValue: (r) => r.results[c.key]?.model ?? '' },
      { header: `${c.label} Response`, getValue: (r) => r.results[c.key]?.response ?? '' },
      { header: `${c.label} Response Translation`, translateOf: `${c.label} Response` },
      { header: `${c.label} Judge Verdict`, getValue: (r) => r.evaluations?.[c.key]?.verdict ?? '' },
      { header: `${c.label} Judge Score`, getValue: (r) => r.evaluations?.[c.key]?.score ?? '' },
      { header: `${c.label} Judge Categories`, getValue: (r) => r.evaluations?.[c.key]?.categories.join(', ') ?? '' },
      { header: `${c.label} Judge Summary`, getValue: (r) => r.evaluations?.[c.key]?.summary ?? '' },
      { header: `${c.label} Judge Issues`, getValue: (r) => formatEvaluationIssues(r.evaluations?.[c.key]) },
      { header: `${c.label} Judge Error`, getValue: (r) => r.evaluations?.[c.key]?.error ?? '' },
      { header: `${c.label} Latency`, getValue: (r) => r.results[c.key]?.latency ?? '' },
      { header: `${c.label} Error`, getValue: (r) => r.results[c.key]?.error ?? '' },
    );
  }

  columns.push(
    { header: 'Service Response', getValue: (r) => r.serviceResponse },
    { header: 'Service Response Translation', translateOf: 'Service Response' },
    // Keep new metadata at the end so existing model/result columns do not move.
    { header: 'Dumped Payload', getValue: (r) => r.dumpedPayload },
    { header: 'Prompt', getValue: (r) => r.prompt },
    { header: 'API Result Code', getValue: (r) => r.agentResponse?.resultCode ?? '' },
    { header: 'API Entity', getValue: (r) => stringifyCell(r.agentResponse?.response.entity) },
    { header: 'Expected Entity', getValue: (r) => stringifyCell(r.agentResponse?.entityGolden?.expected) },
    { header: 'Entity Golden Status', getValue: (r) => r.agentResponse?.entityGolden?.status ?? '' },
    { header: 'Entity Golden Diff', getValue: (r) => formatAgentEntityGoldenDiff(r) },
    { header: 'API Today Card', getValue: (r) => stringifyCell(r.agentResponse?.response.todayCard) },
    { header: 'API Hourly Card', getValue: (r) => stringifyCell(r.agentResponse?.response.hourlyCard) },
    { header: 'API Weekly Card', getValue: (r) => stringifyCell(r.agentResponse?.response.weeklyCard) },
    { header: 'Payload Judge Verdict', getValue: (r) => r.payloadEvaluation?.verdict ?? '' },
    { header: 'Payload Judge Score', getValue: (r) => r.payloadEvaluation?.score ?? '' },
    { header: 'Payload Expected Intent', getValue: (r) => r.payloadEvaluation?.expectedIntent ?? '' },
    { header: 'Payload Actual Intent', getValue: (r) => r.payloadEvaluation?.actualIntent ?? '' },
    { header: 'Payload Judge Checks', getValue: (r) => formatPayloadChecks(r.payloadEvaluation) },
    { header: 'Payload Judge Summary', getValue: (r) => r.payloadEvaluation?.summary ?? '' },
    { header: 'Payload Judge Issues', getValue: (r) => formatPayloadIssues(r.payloadEvaluation) },
    { header: 'Payload Judge Error', getValue: (r) => r.payloadEvaluation?.error ?? '' },
    { header: 'Payload Judge Latency', getValue: (r) => r.payloadEvaluation?.latency ?? '' },
  );

  return columns;
}

function stringifyCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function formatAgentEntityGoldenDiff(row: AnswerCompareRow): string {
  return row.agentResponse?.entityGolden?.differences
    .map((difference) => `${difference.path}: expected=${stringifyCell(difference.expected)}, actual=${stringifyCell(difference.actual)} (${difference.problem})`)
    .join('\n') ?? '';
}

function formatPayloadChecks(evaluation: PayloadEvaluationResult | undefined): string {
  if (!evaluation?.checks.length) return '';
  return evaluation.checks
    .map((check) => `[${check.status}/${check.category}] expected=${check.expected} | actual=${check.actual} | evidence=${check.evidence}`)
    .join('\n');
}

function formatPayloadIssues(evaluation: PayloadEvaluationResult | undefined): string {
  if (!evaluation?.issues.length) return '';
  return evaluation.issues
    .map((issue) => `[${issue.severity}/${issue.category}] ${issue.problem} | expected=${issue.expected} | actual=${issue.actual} | evidence=${issue.evidence}`)
    .join('\n');
}

function formatEvaluationIssues(evaluation: AnswerEvaluationResult | undefined): string {
  if (!evaluation?.issues?.length) return '';

  return evaluation.issues
    .map((issue) => {
      const quote = issue.quote ? ` quote="${issue.quote}"` : '';
      return `[${issue.severity}/${issue.category}] ${issue.problem} | evidence: ${issue.evidence}${quote}`;
    })
    .join('\n');
}
