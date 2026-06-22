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
  /** Per-case results, keyed by CompareCase.key. */
  results: Record<string, AnswerModelResult>;
  /** Per-case GPT judge results, keyed by CompareCase.key. */
  evaluations?: Record<string, AnswerEvaluationResult>;
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
  );

  return columns;
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
