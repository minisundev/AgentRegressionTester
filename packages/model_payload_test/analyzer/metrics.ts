import type {
  AnalysisResult,
  CaseRecord,
  CategoryCell,
  CrossModelStats,
  DataQuality,
  ModelSummary,
  PayloadCross,
  SliceStat,
} from './types.js';

/** Slices smaller than this are noise, not tendency. */
const MIN_SLICE_SUPPORT = 5;

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** A model's judgement on a record counts only when the call and the judge both succeeded. */
function isEvaluated(record: CaseRecord, label: string): boolean {
  const m = record.models[label];
  return Boolean(m && m.verdict && !m.judgeError && !m.modelError);
}

function buildQuality(records: CaseRecord[], labels: string[], duplicatesDropped: number): DataQuality {
  const byModel: DataQuality['byModel'] = {};
  for (const label of labels) {
    byModel[label] = {
      evaluated: records.filter((r) => isEvaluated(r, label)).length,
      judgeErrors: records.filter((r) => r.models[label]?.judgeError).length,
      modelErrors: records.filter((r) => r.models[label]?.modelError).length,
      missingVerdict: records.filter((r) => !r.models[label]?.verdict && !r.models[label]?.judgeError && !r.models[label]?.modelError).length,
    };
  }
  return { totalRows: records.length + duplicatesDropped, duplicatesDropped, byModel };
}

function buildModelSummaries(records: CaseRecord[], labels: string[]): ModelSummary[] {
  return labels.map((label) => {
    const evaluated = records.filter((r) => isEvaluated(r, label)).map((r) => r.models[label]);
    const n = evaluated.length;
    const fail = evaluated.filter((m) => m.verdict === 'fail').length;
    const borderline = evaluated.filter((m) => m.verdict === 'borderline').length;
    const pass = evaluated.filter((m) => m.verdict === 'pass').length;
    const scores = evaluated.map((m) => m.score).filter((s): s is number => s !== undefined);
    const latencies = evaluated.map((m) => m.latencyMs).filter((l): l is number => l !== undefined);
    const criticalCases = evaluated.filter((m) => m.issues.some((i) => i.severity === 'critical')).length;

    return {
      label,
      n,
      pass,
      fail,
      borderline,
      failRate: n ? fail / n : 0,
      hallucinationRate: n ? (fail + borderline) / n : 0,
      scoreMean: mean(scores),
      scoreMedian: percentile(scores, 50),
      scoreP25: percentile(scores, 25),
      scoreMin: scores.length ? Math.min(...scores) : 0,
      criticalCaseRate: n ? criticalCases / n : 0,
      latencyMeanMs: mean(latencies),
    };
  });
}

function buildCategoryMatrix(records: CaseRecord[], labels: string[]): Record<string, Record<string, CategoryCell>> {
  const matrix: Record<string, Record<string, CategoryCell>> = {};
  for (const label of labels) {
    matrix[label] = {};
    for (const record of records) {
      if (!isEvaluated(record, label)) continue;
      const m = record.models[label];
      const touch = (category: string): CategoryCell =>
        (matrix[label][category] ??= { cases: 0, critical: 0, major: 0, minor: 0 });

      for (const category of m.categories) touch(category).cases += 1;
      for (const issue of m.issues) touch(issue.category)[issue.severity] += 1;
    }
  }
  return matrix;
}

function sliceValue(record: CaseRecord, dimension: string): string {
  switch (dimension) {
    case 'group': return record.group;
    case 'subIntent': return record.subIntent;
    case 'language': return record.language;
    case 'forecastScope': return record.weather.forecastScope;
    case 'forecastFormat': return record.weather.forecastFormat;
    case 'weatherMetric': return record.weather.weatherMetric;
    case 'dataPoints': return record.weather.dataPoints;
    case 'availability': return record.weather.availability;
    case 'aggregation': return record.weather.aggregation;
    default: return 'unknown';
  }
}

function buildSlices(records: CaseRecord[], labels: string[]): SliceStat[] {
  const dimensions = ['group', 'subIntent', 'language', 'forecastScope', 'forecastFormat', 'weatherMetric', 'dataPoints', 'availability', 'aggregation'];

  const overallRates = labels.map((label) => {
    const evaluated = records.filter((r) => isEvaluated(r, label));
    return evaluated.length ? evaluated.filter((r) => r.models[label].verdict === 'fail').length / evaluated.length : 0;
  });
  const overallAvgFailRate = mean(overallRates);

  const slices: SliceStat[] = [];
  for (const dimension of dimensions) {
    const values = new Map<string, CaseRecord[]>();
    for (const record of records) {
      const value = sliceValue(record, dimension);
      (values.get(value) ?? values.set(value, []).get(value)!).push(record);
    }

    for (const [value, group] of values) {
      if (group.length < MIN_SLICE_SUPPORT) continue;

      const failRateByModel: Record<string, number> = {};
      const rates: number[] = [];
      for (const label of labels) {
        const evaluated = group.filter((r) => isEvaluated(r, label));
        const rate = evaluated.length ? evaluated.filter((r) => r.models[label].verdict === 'fail').length / evaluated.length : 0;
        failRateByModel[label] = rate;
        if (evaluated.length) rates.push(rate);
      }

      const avgFailRate = mean(rates);
      slices.push({
        dimension,
        value,
        n: group.length,
        failRateByModel,
        avgFailRate,
        lift: overallAvgFailRate > 0 ? avgFailRate / overallAvgFailRate : 0,
      });
    }
  }

  return slices.sort((a, b) => b.avgFailRate - a.avgFailRate);
}

function buildCrossModel(records: CaseRecord[], labels: string[]): CrossModelStats {
  const byFailCount = new Array(labels.length + 1).fill(0) as number[];
  const allFailIds: string[] = [];
  const uniqueFailsByModel: CrossModelStats['uniqueFailsByModel'] = Object.fromEntries(labels.map((l) => [l, []]));

  for (const record of records) {
    const evaluatedLabels = labels.filter((label) => isEvaluated(record, label));
    // Cross-model comparison is only meaningful when every model was judged.
    if (evaluatedLabels.length !== labels.length) continue;

    const failed = labels.filter((label) => record.models[label].verdict === 'fail');
    byFailCount[failed.length] += 1;

    if (failed.length === labels.length) allFailIds.push(record.id);
    if (failed.length === 1) {
      const label = failed[0];
      const m = record.models[label];
      uniqueFailsByModel[label].push({
        id: record.id,
        message: record.messageKo || record.message,
        score: m.score,
        categories: m.categories,
      });
    }
  }

  return { byFailCount, allFailIds, uniqueFailsByModel };
}

function buildPayloadCross(records: CaseRecord[], labels: string[]): PayloadCross {
  const answerFailByPayloadVerdict: Record<string, number> = {};
  const pureAnswerFailIds: string[] = [];

  for (const record of records) {
    const anyFail = labels.some((label) => isEvaluated(record, label) && record.models[label].verdict === 'fail');
    if (!anyFail) continue;

    answerFailByPayloadVerdict[record.payloadVerdict] = (answerFailByPayloadVerdict[record.payloadVerdict] ?? 0) + 1;
    if (record.payloadVerdict === 'pass') pureAnswerFailIds.push(record.id);
  }

  return { answerFailByPayloadVerdict, pureAnswerFailIds };
}

export function buildMetrics(
  tab: string,
  records: CaseRecord[],
  labels: string[],
  duplicatesDropped: number,
): Omit<AnalysisResult, 'clusters'> {
  return {
    tab,
    analyzedAt: new Date().toISOString(),
    quality: buildQuality(records, labels, duplicatesDropped),
    modelSummaries: buildModelSummaries(records, labels),
    categoryMatrix: buildCategoryMatrix(records, labels),
    slices: buildSlices(records, labels),
    crossModel: buildCrossModel(records, labels),
    payloadCross: buildPayloadCross(records, labels),
  };
}

export { isEvaluated };
