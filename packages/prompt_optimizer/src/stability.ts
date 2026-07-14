import path from 'path';
import { runTests } from './testRunner';
import { syncPromptFile } from './promptSync';
import { FOCUS_FILE } from './focus';
import type { ResultRow } from '../../e2e_regression/types/type';
import type { OptimizerConfig, RunResults } from './types';

export interface CaseStability {
  id: string;
  request: string;
  /** temp 라벨("base" 또는 숫자) → 실패 횟수 */
  failsByTemp: Record<string, number>;
  lastFailure?: ResultRow;
}

export interface StabilityReport {
  repeats: number;
  temps: (number | null)[];
  cases: CaseStability[];
  /** 기본 온도에서 매번 실패한 케이스 = 프롬프트가 실제로 틀리는 것 */
  consistent: CaseStability[];
  /** 기본 온도에서 가끔만 실패 = 노이즈 */
  flaky: CaseStability[];
}

function tempLabel(temp: number | null): string {
  return temp === null ? 'base' : String(temp);
}

// focus 케이스들을 (온도별로) repeats회 반복 실행해 실패 빈도를 센다.
// temps[0]이 기준 온도(null=현재 값 유지)이며 consistent/flaky 분류는 기준 온도로만 한다.
export async function probeStability(
  cfg: OptimizerConfig,
  runDir: string,
  label: string,
  repeats: number,
  temps: (number | null)[],
  originalTemperature: number | null,
): Promise<StabilityReport> {
  const byId = new Map<string, CaseStability>();
  const focusCfg = { ...cfg, testArgs: [] as string[] };

  try {
    for (const temp of temps) {
      const tLabel = tempLabel(temp);
      if (temp !== null) await syncPromptFile(cfg, temp);

      for (let r = 1; r <= repeats; r++) {
        const resultPath = path.join(runDir, `${label}.t${tLabel}.r${r}.results.json`);
        const results: RunResults = runTests(
          focusCfg,
          resultPath,
          { TESTCASE_FILES: FOCUS_FILE },
          true,
        );
        console.log(`[optimizer] ${label} temp=${tLabel} run ${r}/${repeats}: ${results.passCount} pass, ${results.failCount} fail`);

        for (const row of [...results.successes, ...results.failures]) {
          const id = String(row.id);
          if (!byId.has(id)) byId.set(id, { id, request: row.request, failsByTemp: {} });
        }
        for (const row of results.failures) {
          const entry = byId.get(String(row.id))!;
          entry.failsByTemp[tLabel] = (entry.failsByTemp[tLabel] ?? 0) + 1;
          entry.lastFailure = row;
        }
      }
    }
  } finally {
    // 온도를 만졌으면 원래 값으로 복원
    if (temps.some((t) => t !== null)) {
      await syncPromptFile(cfg, originalTemperature ?? undefined);
    }
  }

  const baseLabel = tempLabel(temps[0]);
  const cases = [...byId.values()];
  const consistent = cases.filter((c) => (c.failsByTemp[baseLabel] ?? 0) === repeats);
  const flaky = cases.filter((c) => {
    const fails = c.failsByTemp[baseLabel] ?? 0;
    return fails > 0 && fails < repeats;
  });

  return { repeats, temps, cases, consistent, flaky };
}

export function printStabilityReport(report: StabilityReport): void {
  console.log(`\n[optimizer] 안정성 분석 (${report.repeats}회 반복, 온도: ${report.temps.map(tempLabel).join(', ')})`);
  for (const c of report.cases) {
    const cells = report.temps
      .map((t) => `${tempLabel(t)}=${c.failsByTemp[tempLabel(t)] ?? 0}/${report.repeats}`)
      .join(' ');
    const verdict = report.consistent.includes(c) ? 'CONSISTENT-FAIL'
      : report.flaky.includes(c) ? 'FLAKY'
      : 'PASS';
    console.log(`  ${verdict.padEnd(15)} ${cells}  ${c.id}`);
    if (c.lastFailure?.reason) console.log(`    └ ${c.lastFailure.reason.split('\n')[0]}`);
  }
  console.log(`[optimizer] 진짜 실패 ${report.consistent.length}건 / flaky ${report.flaky.length}건\n`);
}
