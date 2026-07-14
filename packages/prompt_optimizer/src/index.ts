import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { runTests } from './testRunner';
import { proposeRevision } from './proposer';
import { assertPromptUpdateServer, syncPromptFile, getCurrentTemperature } from './promptSync';
import { buildFocusFile } from './focus';
import { probeStability, printStabilityReport } from './stability';
import type { ResultRow } from '../../e2e_regression/types/type';
import type { IterationRecord, OptimizerConfig, RunResults } from './types';

const ROOT = path.resolve(__dirname, '../../..');
const PROMPTS_DIR = path.join(ROOT, 'prompts');
const POLICY_PATH = path.join(ROOT, 'spec/weather_agent_policy.md');
const CONFIG_PATH = path.join(__dirname, '../config/optimizer.yaml');
const RUNS_DIR = path.join(__dirname, '../runs');

function loadConfig(): OptimizerConfig {
  const raw = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<OptimizerConfig>;
  const cfg: OptimizerConfig = {
    promptFile: raw.promptFile ?? 'weather_entity.md',
    selector: raw.selector ?? 'terminal:local',
    testArgs: raw.testArgs ?? [],
    maxIterations: raw.maxIterations ?? 3,
    promptUpdateUrl: (raw.promptUpdateUrl ?? 'http://localhost:8083').replace(/\/$/, ''),
    model: raw.model ?? 'gemini-3-flash-preview',
    temperature: raw.temperature ?? 0.3,
    repeats: raw.repeats ?? 3,
    probeTemps: raw.probeTemps ?? [],
    analyzeOnly: false,
  };

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--prompt') cfg.promptFile = args[++i];
    else if (arg === '--selector') cfg.selector = args[++i];
    else if (arg === '--iterations') cfg.maxIterations = Number(args[++i]);
    else if (arg === '--repeat') cfg.repeats = Number(args[++i]);
    else if (arg === '--temps') cfg.probeTemps = args[++i].split(',').map(Number).filter((n) => !Number.isNaN(n));
    else if (arg === '--analyze-only') cfg.analyzeOnly = true;
    else if (arg === '--test-args') cfg.testArgs = args[++i].split(' ').filter(Boolean);
    else throw new Error(`unknown argument: ${arg} (사용법은 packages/prompt_optimizer/README.md 참고)`);
  }
  return cfg;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function summarize(label: string, results: RunResults): void {
  const total = results.passCount + results.failCount;
  console.log(`\n[optimizer] ${label}: ${results.passCount}/${total} pass, ${results.failCount} fail\n`);
}

async function main() {
  const cfg = loadConfig();
  const promptPath = path.join(PROMPTS_DIR, cfg.promptFile);
  if (!fs.existsSync(promptPath)) throw new Error(`prompt file not found: ${promptPath}`);

  await assertPromptUpdateServer(cfg);

  const runDir = path.join(RUNS_DIR, `${timestamp()}_${cfg.promptFile.replace(/\.md$/, '')}`);
  fs.mkdirSync(runDir, { recursive: true });
  console.log(`[optimizer] target=${cfg.promptFile} selector=${cfg.selector} iterations=${cfg.maxIterations} repeats=${cfg.repeats}`);
  console.log(`[optimizer] artifacts → ${path.relative(ROOT, runDir)}`);

  const originalPrompt = fs.readFileSync(promptPath, 'utf8');
  fs.writeFileSync(path.join(runDir, 'baseline.md'), originalPrompt, 'utf8');

  const policy = fs.existsSync(POLICY_PATH) ? fs.readFileSync(POLICY_PATH, 'utf8') : null;
  const history: IterationRecord[] = [];

  try {
    // 1) 전체 baseline 측정 — 파일↔Redis부터 일치시키고 시작
    await syncPromptFile(cfg);
    const baseline = runTests(cfg, path.join(runDir, 'baseline.results.json'));
    summarize('baseline (full)', baseline);

    if (baseline.failCount === 0) {
      console.log('[optimizer] 실패 케이스가 없습니다. 개선할 것이 없어요.');
      return;
    }

    // 2) 실패 케이스만 focus 파일로 추출해 반복 측정 → 진짜 실패와 flaky 분리
    const focus = buildFocusFile(baseline.failures);
    console.log(`[optimizer] focus 추출: ${focus.caseCount} cases (optimizer_focus.yaml)`);
    if (focus.skipped.length > 0) {
      console.warn(`[optimizer] 원본 케이스를 못 찾아 제외: ${focus.skipped.join(', ')}`);
    }

    const originalTemp = await getCurrentTemperature(cfg);
    let report = await probeStability(
      cfg, runDir, 'probe', cfg.repeats, [null, ...cfg.probeTemps], originalTemp,
    );
    printStabilityReport(report);
    fs.writeFileSync(path.join(runDir, 'stability.json'), JSON.stringify(report, null, 2), 'utf8');

    if (cfg.analyzeOnly) {
      console.log('[optimizer] --analyze-only: 분석만 하고 종료합니다.');
      return;
    }
    if (report.consistent.length === 0) {
      console.log('[optimizer] 일관되게 실패하는 케이스가 없습니다 — 전부 flaky라 프롬프트 수정으로 고칠 문제가 아니에요.');
      return;
    }

    // best = 최고 성적 프롬프트. focusFails(반복 측정의 진짜 실패 수)로 겨루고,
    // 전체 실행(fullFails)이 나빠지지 않아야만 채택된다.
    let best = {
      content: originalPrompt,
      label: 'baseline',
      focusFails: report.consistent.length,
      fullFails: baseline.failCount,
    };
    history.push({ label: 'baseline', passCount: baseline.passCount, failCount: baseline.failCount, accepted: true, note: `진짜 실패 ${report.consistent.length}건` });
    let targetFailures: ResultRow[] = report.consistent.map((c) => c.lastFailure!);

    for (let iter = 1; iter <= cfg.maxIterations; iter++) {
      const label = `iter${iter}`;
      console.log(`\n[optimizer] ===== ${label}: 수정안 생성 중 (${cfg.model}) =====`);

      const proposal = await proposeRevision(cfg, best.content, targetFailures, policy, history);
      fs.writeFileSync(path.join(runDir, `${label}.analysis.md`), proposal.analysis, 'utf8');
      fs.writeFileSync(path.join(runDir, `${label}.md`), proposal.prompt, 'utf8');
      console.log(`[optimizer] 분석:\n${proposal.analysis}\n`);

      fs.writeFileSync(promptPath, proposal.prompt, 'utf8');
      await syncPromptFile(cfg);

      // 3) focus 반복 측정으로 1차 판정
      const candReport = await probeStability(cfg, runDir, label, cfg.repeats, [null], originalTemp);
      printStabilityReport(candReport);
      const candFails = candReport.consistent.length;

      let accepted = false;
      let note = `focus ${best.focusFails} → ${candFails}`;

      if (candFails < best.focusFails) {
        // 4) focus가 좋아졌으면 전체 실행으로 회귀 게이트
        console.log(`[optimizer] ${label} focus 개선 (${note}) — 전체 회귀 게이트 실행`);
        const full = runTests(cfg, path.join(runDir, `${label}.full.results.json`));
        summarize(`${label} (full gate)`, full);

        if (full.failCount <= best.fullFails) {
          accepted = true;
          note += `, full ${best.fullFails} → ${full.failCount}`;
          best = { content: proposal.prompt, label, focusFails: candFails, fullFails: full.failCount };
          report = candReport;
          targetFailures = candReport.consistent.map((c) => c.lastFailure!);
        } else {
          note += `, full 회귀 (${best.fullFails} → ${full.failCount})`;
        }
      }

      if (accepted) {
        console.log(`[optimizer] ${label} 채택 (${note})`);
      } else {
        console.log(`[optimizer] ${label} 기각 (${note}) — ${best.label}로 롤백`);
        fs.writeFileSync(promptPath, best.content, 'utf8');
        await syncPromptFile(cfg);
      }
      history.push({ label, passCount: -1, failCount: candFails, accepted, note });

      if (best.focusFails === 0) break;
    }
  } finally {
    // 어떤 경로로 끝나든 파일과 Redis는 best 상태로 맞춘다
    const bestContent = history.length > 0 ? fs.readFileSync(path.join(runDir, historyBestFile(history)), 'utf8') : originalPrompt;
    if (fs.readFileSync(promptPath, 'utf8') !== bestContent) {
      fs.writeFileSync(promptPath, bestContent, 'utf8');
      await syncPromptFile(cfg).catch((e) => console.error(`[optimizer] final sync failed: ${e.message}`));
    }
  }

  console.log('\n[optimizer] ===== 결과 =====');
  for (const h of history) {
    console.log(`  ${h.label.padEnd(10)} ${h.accepted ? '✓ accepted' : '✗ rejected'}  ${h.note ?? ''}`);
  }
  const finalBest = history.filter((h) => h.accepted).pop();
  if (!finalBest || finalBest.label === 'baseline') {
    console.log('[optimizer] 개선안이 채택되지 않아 원본 프롬프트가 유지됩니다.');
  } else {
    console.log(`[optimizer] 최종 채택: ${finalBest.label} — git diff prompts/${cfg.promptFile} 로 확인 후 커밋하세요.`);
  }
}

function historyBestFile(history: IterationRecord[]): string {
  const lastAccepted = history.filter((h) => h.accepted).pop();
  return !lastAccepted || lastAccepted.label === 'baseline' ? 'baseline.md' : `${lastAccepted.label}.md`;
}

main().catch((err) => {
  console.error(`\n[optimizer] 중단: ${err.message}`);
  process.exit(1);
});
