import fs from 'node:fs';
import path from 'node:path';
import { ensureWatcherEnv } from '../llm/env.js';
import { readSheetTab } from './sheetReader.js';
import { parseTable } from './parse.js';
import { buildMetrics } from './metrics.js';
import { clusterIssues } from './cluster.js';
import { buildMarkdownReport, printTerminalReport } from './report.js';
import { writeAnalysisTab } from './sheetWriter.js';
import type { AnalysisResult } from './types.js';

interface CliOptions {
  tab: string;
  cluster: boolean;
  sheet: boolean;
  outDir?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { tab: 'HallucinationT0', cluster: true, sheet: true };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tab') options.tab = argv[++i] ?? options.tab;
    else if (arg === '--no-cluster') options.cluster = false;
    else if (arg === '--no-sheet') options.sheet = false;
    else if (arg === '--out') options.outDir = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run analyze:hallucination [-- --tab HallucinationT0 --no-cluster --no-sheet --out <dir>]');
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }
  return options;
}

function defaultRunDir(tab: string): string {
  const packageRoot = path.resolve(__dirname, '..');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(packageRoot, 'analysis_runs', `${stamp}_${tab}`);
}

async function main(): Promise<void> {
  ensureWatcherEnv();
  const options = parseArgs(process.argv.slice(2));

  console.log(`[analyzer] reading tab "${options.tab}"...`);
  const table = await readSheetTab(options.tab);
  const { records, modelLabels, duplicatesDropped } = parseTable(table);
  console.log(`[analyzer] ${table.rows.length} rows → ${records.length} cases (dupes dropped: ${duplicatesDropped}), models: ${modelLabels.join(' / ')}`);

  const metrics = buildMetrics(options.tab, records, modelLabels, duplicatesDropped);
  const clusters = options.cluster ? await clusterIssues(records, modelLabels) : [];
  const result: AnalysisResult = { ...metrics, clusters };

  printTerminalReport(result);

  const runDir = options.outDir ?? defaultRunDir(options.tab);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'report.md'), buildMarkdownReport(result));
  fs.writeFileSync(path.join(runDir, 'parsed.json'), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(runDir, 'metrics.json'), JSON.stringify(result, null, 2));
  console.log(`\n[analyzer] report: ${path.join(runDir, 'report.md')}`);

  if (options.sheet) {
    await writeAnalysisTab(result, `${options.tab}_Analysis`);
  }
}

main().catch((e) => {
  console.error(`[analyzer] failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
