import type { ResultRow } from '../../e2e_regression/types/type';

export interface OptimizerConfig {
  promptFile: string;
  selector: string;
  testArgs: string[];
  maxIterations: number;
  promptUpdateUrl: string;
  model: string;
  temperature: number;
  /** focus 케이스 반복 측정 횟수 (flaky 분리용) */
  repeats: number;
  /** 안정성 프로브에서 추가로 시험할 프롬프트 temperature 목록 */
  probeTemps: number[];
  analyzeOnly: boolean;
}

export interface RunResults {
  runId: string;
  finishedAt: string;
  passCount: number;
  failCount: number;
  successes: ResultRow[];
  failures: ResultRow[];
}

export interface IterationRecord {
  label: string;
  passCount: number;
  failCount: number;
  accepted: boolean;
  note?: string;
}

export interface Proposal {
  analysis: string;
  prompt: string;
}
