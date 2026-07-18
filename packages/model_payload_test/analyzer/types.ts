export type Verdict = 'pass' | 'fail' | 'borderline';
export type Severity = 'critical' | 'major' | 'minor';

export interface ParsedIssue {
  severity: Severity;
  category: string;
  problem: string;
  evidence: string;
  quote?: string;
}

/** One model(case)'s judged answer on one sheet row. */
export interface ModelEvaluation {
  label: string;
  model: string;
  response: string;
  verdict?: Verdict;
  score?: number;
  categories: string[];
  summary: string;
  issues: ParsedIssue[];
  judgeError: string;
  modelError: string;
  latencyMs?: number;
}

/** Fields parsed (or derived) out of the Weather Data JSON column. */
export interface WeatherMeta {
  forecastScope: string;
  forecastFormat: string;
  weatherMetric: string;
  location: string;
  /** bucketed data[] length: '1' | '2-3' | '4-7' | '8+' | 'none' */
  dataPoints: string;
  /** 'unavailablePast' | 'beyondLimit' | 'none' */
  availability: string;
  /** aggregation stats block present in payload: 'present' | 'none' */
  aggregation: string;
}

export interface CaseRecord {
  testedAt: string;
  group: string;
  id: string;
  message: string;
  messageKo: string;
  subIntent: string;
  language: string;
  weather: WeatherMeta;
  models: Record<string, ModelEvaluation>;
  payloadVerdict: string;
  payloadScore?: number;
}

export interface DataQuality {
  totalRows: number;
  duplicatesDropped: number;
  byModel: Record<string, { evaluated: number; judgeErrors: number; modelErrors: number; missingVerdict: number }>;
}

export interface ModelSummary {
  label: string;
  n: number;
  pass: number;
  fail: number;
  borderline: number;
  failRate: number;
  /** fail + borderline */
  hallucinationRate: number;
  scoreMean: number;
  scoreMedian: number;
  scoreP25: number;
  scoreMin: number;
  criticalCaseRate: number;
  latencyMeanMs: number;
}

export interface CategoryCell {
  /** rows whose judge `categories` include this category */
  cases: number;
  critical: number;
  major: number;
  minor: number;
}

export interface SliceStat {
  dimension: string;
  value: string;
  n: number;
  /** per model label: fail rate within the slice */
  failRateByModel: Record<string, number>;
  /** mean of per-model fail rates in the slice */
  avgFailRate: number;
  /** avgFailRate / overall avgFailRate */
  lift: number;
}

export interface CrossModelStats {
  /** index = number of models that failed on the case */
  byFailCount: number[];
  allFailIds: string[];
  uniqueFailsByModel: Record<string, Array<{ id: string; message: string; score?: number; categories: string[] }>>;
}

export interface PayloadCross {
  /** answer-fail cases bucketed by payload judge verdict */
  answerFailByPayloadVerdict: Record<string, number>;
  /** answer fail while payload judge passed → pure answer-stage hallucination */
  pureAnswerFailIds: string[];
}

export interface IssueForClustering {
  caseId: string;
  message: string;
  model: string;
  category: string;
  severity: Severity;
  problem: string;
  evidence: string;
}

export interface IssueCluster {
  name: string;
  description: string;
  category: string;
  count: number;
  countByModel: Record<string, number>;
  exampleCaseIds: string[];
  representativeQuote: string;
}

export interface AnalysisResult {
  tab: string;
  analyzedAt: string;
  quality: DataQuality;
  modelSummaries: ModelSummary[];
  categoryMatrix: Record<string, Record<string, CategoryCell>>;
  slices: SliceStat[];
  crossModel: CrossModelStats;
  payloadCross: PayloadCross;
  clusters: IssueCluster[];
}
