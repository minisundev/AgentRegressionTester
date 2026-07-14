import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { OptimizerConfig, RunResults } from './types';

const ROOT = path.resolve(__dirname, '../../..');

export function runTests(
  cfg: OptimizerConfig,
  resultJsonPath: string,
  extraEnv: Record<string, string> = {},
  quiet = false,
): RunResults {
  fs.mkdirSync(path.dirname(resultJsonPath), { recursive: true });

  // 옵티마이저는 매 라운드 전체 케이스를 다시 재야 하므로 러너의 체크포인트
  // 스킵을 무력화한다. 사용자가 쓰는 .checkpoint.json은 건드리지 않도록
  // 실행마다 결과 파일 옆에 새 체크포인트를 만든다 (동시 실행 간섭 방지).
  const checkpointFile = `${resultJsonPath}.checkpoint.json`;
  if (fs.existsSync(checkpointFile)) fs.unlinkSync(checkpointFile);

  const args = ['scripts/run-test-profile.js', cfg.selector];
  if (cfg.testArgs.length > 0) args.push('--', ...cfg.testArgs);

  if (!quiet) console.log(`[optimizer] running: node ${args.join(' ')}`);
  const result = spawnSync('node', args, {
    cwd: ROOT,
    stdio: quiet ? 'ignore' : 'inherit',
    env: {
      ...process.env,
      RESULT_JSON_PATH: resultJsonPath,
      CHECKPOINT_FILE: checkpointFile,
      ...extraEnv,
    },
  });

  if (result.error) throw result.error;
  if (!fs.existsSync(resultJsonPath)) {
    throw new Error(
      `test run produced no results file (exit=${result.status}). ` +
      'jest 실행 자체가 실패했는지 위 로그를 확인하세요.'
    );
  }

  const results = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8')) as RunResults;
  guardInfraFailures(results);
  return results;
}

// 에이전트 서버가 죽어 있으면 실패가 전부 네트워크 에러로 나온다.
// 그 노이즈로 프롬프트를 "개선"하면 안 되므로 감지 즉시 중단한다.
function guardInfraFailures(results: RunResults): void {
  const infraPattern = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|socket hang up|HTTP 5\d\d|\[HTTP |\[ERROR /i;
  const infraCount = results.failures.filter(
    (f) => infraPattern.test(f.reason ?? '') || infraPattern.test(f.response ?? '')
  ).length;

  const total = results.passCount + results.failCount;
  if (total > 0 && infraCount > 0 && infraCount >= Math.ceil(results.failCount / 2)) {
    throw new Error(
      `실패 ${results.failCount}건 중 ${infraCount}건이 네트워크/서버 에러입니다. ` +
      '에이전트 서버(CONTROL_BASE_URL) 상태를 먼저 확인하세요 — 프롬프트 문제가 아닙니다.'
    );
  }
}
