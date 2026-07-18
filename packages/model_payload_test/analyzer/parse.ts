import type { CaseRecord, ModelEvaluation, ParsedIssue, Severity, Verdict, WeatherMeta } from './types.js';
import type { SheetTable } from './sheetReader.js';

const VERDICTS = new Set(['pass', 'fail', 'borderline']);
const SEVERITIES = new Set(['critical', 'major', 'minor']);

export interface ParseOutput {
  records: CaseRecord[];
  modelLabels: string[];
  duplicatesDropped: number;
}

/**
 * Case column groups are detected from `<label> Judge Verdict` headers
 * (excluding the tail-block `Payload Judge Verdict`), so renamed or added
 * cases in the compare YAML keep working without code changes.
 */
export function detectModelLabels(header: string[]): string[] {
  return header
    .filter((h) => h.endsWith(' Judge Verdict') && h !== 'Payload Judge Verdict')
    .map((h) => h.slice(0, -' Judge Verdict'.length));
}

/**
 * Reverse of formatEvaluationIssues (types/answerCompare.ts): newline-joined
 * lines of `[severity/CATEGORY] problem | evidence: ... quote="..."`.
 */
export function parseIssues(raw: string): ParsedIssue[] {
  if (!raw.trim()) return [];

  const issues: ParsedIssue[] = [];
  for (const line of raw.split('\n')) {
    const match = line.match(/^\[(\w+)\/([A-Z_]+)\]\s*(.*)$/s);
    if (!match) continue;
    const [, severityRaw, category, rest] = match;
    const severity = (SEVERITIES.has(severityRaw) ? severityRaw : 'minor') as Severity;

    let problem = rest;
    let evidence = '';
    let quote: string | undefined;

    const evidenceSplit = rest.split(' | evidence: ');
    if (evidenceSplit.length > 1) {
      problem = evidenceSplit[0];
      evidence = evidenceSplit.slice(1).join(' | evidence: ');
      const quoteMatch = evidence.match(/^(.*)\squote="(.*)"$/s);
      if (quoteMatch) {
        evidence = quoteMatch[1];
        quote = quoteMatch[2];
      }
    }

    issues.push({ severity, category, problem: problem.trim(), evidence: evidence.trim(), quote });
  }
  return issues;
}

function bucketDataPoints(count: number): string {
  if (count <= 0) return 'none';
  if (count === 1) return '1';
  if (count <= 3) return '2-3';
  if (count <= 7) return '4-7';
  return '8+';
}

/**
 * The Weather Data payload comes in two shapes: a small minority carries
 * explicit forecastScope/forecastFormat; most rows only have a `data`
 * array — for those, scope/format are derived from the data itself
 * (dateTime with a time part → hourly, array length → single/multi).
 */
function parseWeatherMeta(raw: string): WeatherMeta {
  const unknown: WeatherMeta = {
    forecastScope: 'unknown', forecastFormat: 'unknown', weatherMetric: '(unparsed)',
    location: 'unknown', dataPoints: 'unknown', availability: 'unknown', aggregation: 'unknown',
  };
  if (!raw.trim()) return unknown;

  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const metric = data.weatherMetric;
    const metricLabel = Array.isArray(metric)
      ? (metric.length ? metric.map(String).sort().join('+') : '(none)')
      : (metric ? String(metric) : '(none)');

    const points = Array.isArray(data.data) ? data.data : (data.data ? [data.data] : []);
    const first = points[0] as Record<string, unknown> | undefined;
    const firstDateTime = String(first?.dateTime ?? first?.date ?? '');
    const derivedScope = points.length === 0 ? 'no-data' : (firstDateTime.includes(':') ? 'hourly(derived)' : 'daily(derived)');
    const derivedFormat = points.length === 0 ? 'no-data' : (points.length === 1 ? 'single(derived)' : 'list(derived)');

    return {
      forecastScope: data.forecastScope ? String(data.forecastScope) : derivedScope,
      forecastFormat: data.forecastFormat ? String(data.forecastFormat) : derivedFormat,
      weatherMetric: metricLabel,
      location: String(data.location ?? 'unknown'),
      dataPoints: bucketDataPoints(points.length),
      availability: data.requestedUnavailablePast
        ? 'unavailablePast'
        : data.requestedBeyondForecastLimit
          ? 'beyondLimit'
          : 'none',
      aggregation: data.aggregation ? 'present' : 'none',
    };
  } catch {
    return unknown;
  }
}

function parseModelEvaluation(label: string, get: (header: string) => string): ModelEvaluation {
  const verdictRaw = get(`${label} Judge Verdict`).trim().toLowerCase();
  const scoreRaw = get(`${label} Judge Score`).trim();
  const score = Number(scoreRaw);
  const latency = Number(get(`${label} Latency`).trim());

  return {
    label,
    model: get(`${label} Model`),
    response: get(`${label} Response`),
    verdict: VERDICTS.has(verdictRaw) ? (verdictRaw as Verdict) : undefined,
    score: scoreRaw !== '' && Number.isFinite(score) ? score : undefined,
    categories: get(`${label} Judge Categories`).split(',').map((c) => c.trim()).filter(Boolean),
    summary: get(`${label} Judge Summary`),
    issues: parseIssues(get(`${label} Judge Issues`)),
    judgeError: get(`${label} Judge Error`).trim(),
    modelError: get(`${label} Error`).trim(),
    latencyMs: Number.isFinite(latency) && latency > 0 ? latency : undefined,
  };
}

export function parseTable(table: SheetTable): ParseOutput {
  const modelLabels = detectModelLabels(table.header);
  if (modelLabels.length === 0) {
    throw new Error('No "<label> Judge Verdict" columns found — is this an answer-compare tab?');
  }

  const colIndex = new Map(table.header.map((h, i) => [h, i]));
  const records: CaseRecord[] = [];

  for (const row of table.rows) {
    const get = (header: string): string => {
      const idx = colIndex.get(header);
      return idx === undefined ? '' : (row[idx] ?? '');
    };
    if (!get('ID').trim()) continue;

    const payloadScoreRaw = get('Payload Judge Score').trim();
    const payloadScore = Number(payloadScoreRaw);

    records.push({
      testedAt: get('Tested At'),
      group: get('Group') || 'unknown',
      id: get('ID').trim(),
      message: get('Message'),
      messageKo: get('Message Translation'),
      subIntent: get('SubIntent') || 'unknown',
      language: get('Language') || 'unknown',
      weather: parseWeatherMeta(get('Weather Data')),
      models: Object.fromEntries(modelLabels.map((label) => [label, parseModelEvaluation(label, get)])),
      payloadVerdict: get('Payload Judge Verdict').trim().toLowerCase() || 'none',
      payloadScore: payloadScoreRaw !== '' && Number.isFinite(payloadScore) ? payloadScore : undefined,
    });
  }

  // Redis pending retries can append the same trxId more than once — keep the latest run.
  const byId = new Map<string, CaseRecord>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing || record.testedAt >= existing.testedAt) byId.set(record.id, record);
  }

  return {
    records: [...byId.values()],
    modelLabels,
    duplicatesDropped: records.length - byId.size,
  };
}
