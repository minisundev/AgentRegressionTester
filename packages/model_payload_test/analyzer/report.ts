import Table from 'cli-table3';
import type { AnalysisResult, CategoryCell } from './types.js';

const TOP_SLICES = 15;
const TOP_CLUSTERS = 10;

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function categoryNames(result: AnalysisResult): string[] {
  const names = new Set<string>();
  for (const cells of Object.values(result.categoryMatrix)) {
    for (const name of Object.keys(cells)) names.add(name);
  }
  return [...names].sort((a, b) => {
    const total = (name: string) =>
      Object.values(result.categoryMatrix).reduce((sum, cells) => sum + (cells[name]?.cases ?? 0), 0);
    return total(b) - total(a);
  });
}

function cellSummary(cell: CategoryCell | undefined): string {
  if (!cell) return '-';
  return `${cell.cases} (c${cell.critical}/m${cell.major}/n${cell.minor})`;
}

export function printTerminalReport(result: AnalysisResult): void {
  const labels = result.modelSummaries.map((m) => m.label);

  console.log(`\n=== HallucinationT0 분석 — tab "${result.tab}" ===`);
  console.log(
    `rows ${result.quality.totalRows} (dedupe로 ${result.quality.duplicatesDropped}건 제외 → ${result.quality.totalRows - result.quality.duplicatesDropped}케이스)`,
  );

  const summaryTable = new Table({ head: ['Model', 'n', 'fail', 'border', 'pass', 'fail율', 'fail+border', 'score μ/med/p25', 'critical케이스'] });
  for (const m of result.modelSummaries) {
    summaryTable.push([
      m.label, m.n, m.fail, m.borderline, m.pass,
      pct(m.failRate), pct(m.hallucinationRate),
      `${m.scoreMean.toFixed(0)}/${m.scoreMedian}/${m.scoreP25}`,
      pct(m.criticalCaseRate),
    ]);
  }
  console.log('\n[모델별 요약]');
  console.log(summaryTable.toString());

  const catTable = new Table({ head: ['Category', ...labels.map((l) => `${l} cases(sev)`)] });
  for (const name of categoryNames(result)) {
    catTable.push([name, ...labels.map((label) => cellSummary(result.categoryMatrix[label]?.[name]))]);
  }
  console.log('\n[카테고리 × 모델 — cases (critical/major/minor issues)]');
  console.log(catTable.toString());

  const sliceTable = new Table({ head: ['Dimension', 'Value', 'n', ...labels.map((l) => `${l} fail`), 'lift'] });
  for (const slice of result.slices.slice(0, TOP_SLICES)) {
    sliceTable.push([
      slice.dimension, slice.value, slice.n,
      ...labels.map((label) => pct(slice.failRateByModel[label] ?? 0)),
      `x${slice.lift.toFixed(2)}`,
    ]);
  }
  console.log(`\n[fail율 상위 슬라이스 Top ${TOP_SLICES} (n≥5, lift는 전체 평균 fail율 대비)]`);
  console.log(sliceTable.toString());

  const crossTable = new Table({ head: ['실패 모델 수', '케이스 수'] });
  result.crossModel.byFailCount.forEach((count, failCount) => crossTable.push([failCount, count]));
  console.log('\n[교차 분석 — 케이스별 실패 모델 수 (3모델 모두 판정된 케이스만)]');
  console.log(crossTable.toString());
  for (const label of labels) {
    console.log(`  ${label} 단독 실패: ${result.crossModel.uniqueFailsByModel[label]?.length ?? 0}건`);
  }
  console.log(`  전 모델 실패(시스템 문제 후보): ${result.crossModel.allFailIds.length}건`);

  console.log('\n[answer fail × payload judge]');
  for (const [verdict, count] of Object.entries(result.payloadCross.answerFailByPayloadVerdict)) {
    console.log(`  payload=${verdict}: ${count}건`);
  }
  console.log(`  순수 답변 할루시네이션(payload pass인데 answer fail): ${result.payloadCross.pureAnswerFailIds.length}건`);

  if (result.clusters.length) {
    const clusterTable = new Table({ head: ['패턴', 'Category', 'count', '모델 분포'], colWidths: [40, 24, 8, 30], wordWrap: true });
    for (const cluster of result.clusters.slice(0, TOP_CLUSTERS)) {
      clusterTable.push([
        cluster.name,
        cluster.category,
        cluster.count,
        Object.entries(cluster.countByModel).map(([m, c]) => `${m}: ${c}`).join('\n'),
      ]);
    }
    console.log(`\n[반복 패턴 Top ${TOP_CLUSTERS} (LLM 클러스터링)]`);
    console.log(clusterTable.toString());
  }
}

export function buildMarkdownReport(result: AnalysisResult): string {
  const labels = result.modelSummaries.map((m) => m.label);
  const lines: string[] = [];

  lines.push(`# Hallucination 경향성 분석 — \`${result.tab}\``);
  lines.push('');
  lines.push(`- 분석 시각: ${result.analyzedAt}`);
  lines.push(`- 시트 행 수: ${result.quality.totalRows} (trxId 중복 제외 ${result.quality.duplicatesDropped}건 → 분석 대상 ${result.quality.totalRows - result.quality.duplicatesDropped}케이스)`);
  lines.push('');

  lines.push('## 1. 모델별 요약');
  lines.push('');
  lines.push('| Model | n | fail | borderline | pass | fail율 | fail+borderline | score mean | median | p25 | min | critical 케이스율 | latency mean(ms) |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const m of result.modelSummaries) {
    lines.push(`| ${m.label} | ${m.n} | ${m.fail} | ${m.borderline} | ${m.pass} | ${pct(m.failRate)} | ${pct(m.hallucinationRate)} | ${m.scoreMean.toFixed(1)} | ${m.scoreMedian} | ${m.scoreP25} | ${m.scoreMin} | ${pct(m.criticalCaseRate)} | ${m.latencyMeanMs.toFixed(0)} |`);
  }
  lines.push('');
  lines.push('- `n`은 모델 호출 에러/judge 에러 행을 제외한 유효 판정 수.');
  lines.push('');

  lines.push('## 2. 카테고리 × 모델');
  lines.push('');
  lines.push('셀 형식: 해당 카테고리가 verdict categories에 잡힌 케이스 수 (issue severity: critical/major/minor).');
  lines.push('');
  lines.push(`| Category | ${labels.join(' | ')} |`);
  lines.push(`|---|${labels.map(() => '---').join('|')}|`);
  for (const name of categoryNames(result)) {
    lines.push(`| ${name} | ${labels.map((label) => cellSummary(result.categoryMatrix[label]?.[name])).join(' | ')} |`);
  }
  lines.push('');

  lines.push(`## 3. 발생 조건 슬라이스 (fail율 상위, n≥5)`);
  lines.push('');
  lines.push(`| Dimension | Value | n | ${labels.map((l) => `${l} fail율`).join(' | ')} | 평균 fail율 | lift |`);
  lines.push(`|---|---|---|${labels.map(() => '---').join('|')}|---|---|`);
  for (const slice of result.slices.slice(0, TOP_SLICES * 2)) {
    lines.push(`| ${slice.dimension} | ${slice.value} | ${slice.n} | ${labels.map((label) => pct(slice.failRateByModel[label] ?? 0)).join(' | ')} | ${pct(slice.avgFailRate)} | x${slice.lift.toFixed(2)} |`);
  }
  lines.push('');

  lines.push('## 4. 모델 특이성 (교차 분석)');
  lines.push('');
  lines.push('| 실패 모델 수 | 케이스 수 |');
  lines.push('|---|---|');
  result.crossModel.byFailCount.forEach((count, failCount) => lines.push(`| ${failCount} | ${count} |`));
  lines.push('');
  lines.push(`- **전 모델 실패 ${result.crossModel.allFailIds.length}건** — 모델보다는 프롬프트/페이로드/judge 기준의 시스템 문제 후보: ${result.crossModel.allFailIds.slice(0, 20).map((id) => `\`${id}\``).join(', ')}${result.crossModel.allFailIds.length > 20 ? ' …' : ''}`);
  for (const label of labels) {
    const fails = result.crossModel.uniqueFailsByModel[label] ?? [];
    lines.push(`- **${label} 단독 실패 ${fails.length}건** (모델 고유 약점 후보)`);
    for (const f of fails.slice(0, 10)) {
      lines.push(`  - \`${f.id}\` ${f.message} — score ${f.score ?? '?'} [${f.categories.join(', ')}]`);
    }
    if (fails.length > 10) lines.push(`  - … 외 ${fails.length - 10}건 (parsed.json 참고)`);
  }
  lines.push('');

  lines.push('## 5. 원인 계층 — answer fail × payload judge');
  lines.push('');
  lines.push('| Payload judge verdict | answer fail 케이스 수 |');
  lines.push('|---|---|');
  for (const [verdict, count] of Object.entries(result.payloadCross.answerFailByPayloadVerdict)) {
    lines.push(`| ${verdict} | ${count} |`);
  }
  lines.push('');
  lines.push(`- payload pass인데 answer fail(순수 답변 단계 할루시네이션): **${result.payloadCross.pureAnswerFailIds.length}건**`);
  lines.push('');

  if (result.clusters.length) {
    lines.push('## 6. 반복 패턴 (LLM 클러스터링)');
    lines.push('');
    result.clusters.forEach((cluster, index) => {
      lines.push(`### ${index + 1}. ${cluster.name} — ${cluster.count}건 [${cluster.category}]`);
      lines.push('');
      lines.push(cluster.description);
      lines.push('');
      lines.push(`- 모델 분포: ${Object.entries(cluster.countByModel).map(([m, c]) => `${m} ${c}건`).join(', ')}`);
      lines.push(`- 대표 사례: ${cluster.exampleCaseIds.map((id) => `\`${id}\``).join(', ')}`);
      lines.push(`- 대표 지적: ${cluster.representativeQuote}`);
      lines.push('');
    });
  }

  lines.push('## 7. 데이터 품질');
  lines.push('');
  lines.push('| Model | 유효 판정 | judge error | model error | verdict 없음 |');
  lines.push('|---|---|---|---|---|');
  for (const [label, q] of Object.entries(result.quality.byModel)) {
    lines.push(`| ${label} | ${q.evaluated} | ${q.judgeErrors} | ${q.modelErrors} | ${q.missingVerdict} |`);
  }
  lines.push('');
  lines.push('에러/판정누락 행은 위 모든 통계의 분모에서 제외됨.');
  lines.push('');

  return lines.join('\n');
}
