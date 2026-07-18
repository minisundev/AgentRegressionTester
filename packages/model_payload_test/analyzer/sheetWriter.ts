import { createSheetsClient, toA1SheetRange } from './sheetReader.js';
import type { AnalysisResult } from './types.js';

type Row = (string | number)[];

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function buildValues(result: AnalysisResult): Row[] {
  const labels = result.modelSummaries.map((m) => m.label);
  const rows: Row[] = [];
  const section = (title: string) => {
    rows.push([]);
    rows.push([`■ ${title}`]);
  };

  rows.push([`Hallucination 경향성 분석 — ${result.tab}`]);
  rows.push(['분석 시각', result.analyzedAt]);
  rows.push(['분석 케이스 수', result.quality.totalRows - result.quality.duplicatesDropped, `(시트 ${result.quality.totalRows}행, 중복 ${result.quality.duplicatesDropped}건 제외)`]);

  section('모델별 요약');
  rows.push(['Model', 'n', 'fail', 'borderline', 'pass', 'fail율', 'fail+borderline', 'score mean', 'score median', 'score p25', 'critical 케이스율']);
  for (const m of result.modelSummaries) {
    rows.push([m.label, m.n, m.fail, m.borderline, m.pass, pct(m.failRate), pct(m.hallucinationRate), m.scoreMean.toFixed(1), m.scoreMedian, m.scoreP25, pct(m.criticalCaseRate)]);
  }

  section('카테고리 × 모델 (cases / critical / major / minor)');
  rows.push(['Category', ...labels.flatMap((l) => [`${l} cases`, `${l} crit`, `${l} major`, `${l} minor`])]);
  const categories = new Set<string>();
  for (const cells of Object.values(result.categoryMatrix)) Object.keys(cells).forEach((c) => categories.add(c));
  for (const category of categories) {
    rows.push([
      category,
      ...labels.flatMap((label) => {
        const cell = result.categoryMatrix[label]?.[category];
        return [cell?.cases ?? 0, cell?.critical ?? 0, cell?.major ?? 0, cell?.minor ?? 0];
      }),
    ]);
  }

  section('발생 조건 슬라이스 (fail율 상위, n≥5)');
  rows.push(['Dimension', 'Value', 'n', ...labels.map((l) => `${l} fail율`), '평균 fail율', 'lift']);
  for (const slice of result.slices.slice(0, 30)) {
    rows.push([slice.dimension, slice.value, slice.n, ...labels.map((l) => pct(slice.failRateByModel[l] ?? 0)), pct(slice.avgFailRate), `x${slice.lift.toFixed(2)}`]);
  }

  section('모델 특이성');
  rows.push(['실패 모델 수', '케이스 수']);
  result.crossModel.byFailCount.forEach((count, failCount) => rows.push([failCount, count]));
  rows.push(['전 모델 실패(시스템 문제 후보)', result.crossModel.allFailIds.length, result.crossModel.allFailIds.slice(0, 30).join(', ')]);
  for (const label of labels) {
    const fails = result.crossModel.uniqueFailsByModel[label] ?? [];
    rows.push([`${label} 단독 실패`, fails.length, fails.slice(0, 30).map((f) => f.id).join(', ')]);
  }

  section('원인 계층 — answer fail × payload judge');
  rows.push(['Payload verdict', 'answer fail 케이스 수']);
  for (const [verdict, count] of Object.entries(result.payloadCross.answerFailByPayloadVerdict)) rows.push([verdict, count]);
  rows.push(['순수 답변 할루시네이션(payload pass & answer fail)', result.payloadCross.pureAnswerFailIds.length]);

  if (result.clusters.length) {
    section('반복 패턴 (LLM 클러스터링)');
    rows.push(['패턴', '설명', 'Category', 'count', '모델 분포', '대표 사례', '대표 지적']);
    for (const cluster of result.clusters) {
      rows.push([
        cluster.name,
        cluster.description,
        cluster.category,
        cluster.count,
        Object.entries(cluster.countByModel).map(([m, c]) => `${m}: ${c}`).join(', '),
        cluster.exampleCaseIds.join(', '),
        cluster.representativeQuote,
      ]);
    }
  }

  section('데이터 품질 (에러 행은 통계 분모에서 제외)');
  rows.push(['Model', '유효 판정', 'judge error', 'model error', 'verdict 없음']);
  for (const [label, q] of Object.entries(result.quality.byModel)) {
    rows.push([label, q.evaluated, q.judgeErrors, q.modelErrors, q.missingVerdict]);
  }

  return rows;
}

/** Rewrite the analysis tab from scratch — the analysis is a snapshot, not a log. */
export async function writeAnalysisTab(result: AnalysisResult, tab: string): Promise<void> {
  const { sheets, spreadsheetId } = createSheetsClient(false);

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = spreadsheet.data.sheets?.some((sheet) => sheet.properties?.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: toA1SheetRange(tab, 'A:Z'),
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: toA1SheetRange(tab, 'A1'),
    valueInputOption: 'RAW',
    requestBody: { values: buildValues(result) },
  });

  console.log(`[analyzer] wrote analysis to tab "${tab}"`);
}
