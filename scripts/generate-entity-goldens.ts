import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { callGpt } from '../src/llm/clients';
import type { DumpedPayload } from '../src/llm/payloadStore';
import type { TestCase } from '../tests/types/type';

const DIR = path.resolve(process.cwd(), 'tests/config/testcases');
const PROMPT_FILE = process.env.ENTITY_PARSER_PROMPT_FILE
  ?? '/Users/minisun/.codex/attachments/00a634fe-11aa-44d5-93a3-f6824ff5a0f1/pasted-text.txt';
const CHECKPOINT = path.resolve(process.cwd(), '.entity-golden-generation.json');
const BATCH_SIZE = Number(process.env.ENTITY_GOLDEN_BATCH_SIZE ?? '12');
const CONCURRENCY = Number(process.env.ENTITY_GOLDEN_GENERATION_CONCURRENCY ?? '5');
const LLM_ID = Number(process.env.GPT_JUDGE_LLM_ID ?? '6');
const REQUIRED_FIELDS = [
  'reasoning', 'location', 'localizedLocation', 'country', 'weatherMetric',
  'delta', 'deltaUnit', 'rangeRelation', 'requestedGranularity', 'timeOfDay',
  'relativeHours', 'specificHour', 'meridiem', 'relativeDays', 'specificDate',
  'specificWeekday', 'relativeWeeks', 'weekPart', 'fallback',
];

interface FileData { groupName: string; cases: TestCase[] }
interface WorkItem { key: string; message: string; context: string[]; cases: TestCase[] }
interface State { entities: Record<string, Record<string, unknown>> }

const state: State = fs.existsSync(CHECKPOINT)
  ? JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8'))
  : { entities: {} };

async function main(): Promise<void> {
  const spec = fs.readFileSync(PROMPT_FILE, 'utf8');
  const files = fs.readdirSync(DIR).filter((name) => name.endsWith('.yaml')).sort()
    .map((name) => ({ name, data: yaml.load(fs.readFileSync(path.join(DIR, name), 'utf8')) as FileData }));
  const items = buildItems(files.map((file) => file.data));
  const pending = items.filter((item) => !state.entities[item.key]);
  const batches = chunk(pending, BATCH_SIZE);
  console.log(`[golden-generator] weatherCases=${items.reduce((n, x) => n + x.cases.length, 0)} unique=${items.length} pending=${pending.length} batches=${batches.length}`);

  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length || 1) }, async () => {
    for (;;) {
      const index = cursor++;
      const batch = batches[index];
      if (!batch) return;
      const generated = await generateBatch(spec, batch);
      Object.assign(state.entities, generated);
      persist();
      if ((index + 1) % 5 === 0) console.log(`[golden-generator] batches=${index + 1}/${batches.length}`);
    }
  }));

  for (const item of items) {
    const entity = state.entities[item.key];
    if (!entity) throw new Error(`missing generated entity: ${item.key}`);
    const normalized = Object.fromEntries(Object.entries(entity).map(([key, value]) => [key, key === 'reasoning' ? { $any: true } : value]));
    if (!Object.prototype.hasOwnProperty.call(normalized, 'requestedPresentation')) normalized.requestedPresentation = null;
    for (const tc of item.cases) {
      tc.expectedEntity = normalized;
      tc.entityMatchMode = 'exact';
    }
  }
  for (const file of files) rewrite(file.name, file.data);
  console.log(`[golden-generator] wrote ${files.length} YAML files`);
}

function buildItems(files: FileData[]): WorkItem[] {
  const map = new Map<string, WorkItem>();
  for (const file of files) {
    const histories = new Map<string, string[]>();
    for (const tc of file.cases ?? []) {
      if (tc.mainIntent !== 'Weather' || tc.agentType !== 'DailyInfoAgent') continue;
      const multi = tc.isMultiTurn === true || tc.multiTurn === true;
      const parent = String(tc.id).replace(/-\d+$/, '');
      const historyKey = `${file.groupName}:${parent}`;
      const context = multi ? [...(histories.get(historyKey) ?? [])] : [];
      const key = JSON.stringify([tc.message, tc.subIntent, context]);
      const existing = map.get(key);
      if (existing) existing.cases.push(tc);
      else map.set(key, { key, message: tc.message, context, cases: [tc] });
      if (multi) histories.set(historyKey, [...context, tc.message]);
    }
  }
  return [...map.values()];
}

async function generateBatch(spec: string, batch: WorkItem[]): Promise<Record<string, Record<string, unknown>>> {
  const input = batch.map((item) => ({ key: item.key, query: item.message, previousTurns: item.context }));
  const system = `${spec}\n\nBATCH GOLDEN MODE:\nApply the specification independently to every item. GIVEN_LANGUAGE is vi, currentYear is 2026, and currentMonth is 07. PreviousTurns are context for inheritance only. Return one JSON object: {"results":[{"key":"exact input key","entity":{...}}]}. Every entity must contain every specified output field. No markdown.`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const payload: DumpedPayload = {
      trxId: `entity-golden-batch-${Date.now()}`,
      mainIntent: 'Weather', subIntent: 'EntityGolden', language: 'vi',
      prompt: system, userMessage: JSON.stringify({ items: input }), weatherData: '{}',
      llmParams: { temperature: 0, topP: 1, maxOutputTokens: 16000, responseFormat: 'json_object' },
      connectionConfig: { url: '', group: '', version: '', auth_key: null },
    };
    const result = await callGpt(payload, { llmId: LLM_ID, temperature: 0 });
    if (result.error) { if (attempt === 3) throw new Error(result.error); continue; }
    try {
      const parsed = JSON.parse(extractObject(result.response)) as { results?: Array<{ key: string; entity: Record<string, unknown> }> };
      const output: Record<string, Record<string, unknown>> = {};
      for (const row of parsed.results ?? []) {
        if (batch.some((item) => item.key === row.key) && REQUIRED_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(row.entity, field))) output[row.key] = row.entity;
      }
      if (Object.keys(output).length === batch.length) return output;
    } catch { /* retry */ }
  }
  throw new Error(`failed batch: ${batch.map((item) => item.message).join(' | ')}`);
}

function rewrite(name: string, data: FileData): void {
  const file = path.join(DIR, name); const text = fs.readFileSync(file, 'utf8');
  const matches = [...text.matchAll(/^([ \t]*)- id:/gm)];
  const starts = matches.map((match) => match.index!);
  if (starts.length !== (data.cases ?? []).length) throw new Error(`${name}: case count mismatch`);
  const blocks = starts.map((start, i) => text.slice(start, starts[i + 1] ?? text.length));
  const out = blocks.map((block, i) => {
    const tc = data.cases[i]!;
    if (tc.expectedEntity === undefined) return block;
    const caseIndent = matches[i]?.[1] ?? '';
    const propertyIndent = `${caseIndent}  `;
    const lines = block.split('\n');
    const kept: string[] = [];
    let skippingEntity = false;
    for (const line of lines) {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (line.startsWith(`${propertyIndent}expectedEntity:`)) { skippingEntity = true; continue; }
      if (skippingEntity && line.trim() && indent > propertyIndent.length) continue;
      if (skippingEntity) skippingEntity = false;
      if (line.startsWith(`${propertyIndent}entityMatchMode:`)) continue;
      kept.push(line);
    }
    const clean = kept.join('\n');
    const dumped = yaml.dump({ expectedEntity: tc.expectedEntity, entityMatchMode: 'exact' }, { noRefs: true, lineWidth: -1 })
      .trimEnd().split('\n').map((line) => `${propertyIndent}${line}`).join('\n');
    const agentPattern = new RegExp(`^${propertyIndent}agentType:.*$`, 'm');
    if (!agentPattern.test(clean)) throw new Error(`${name} Q${tc.id}: agentType missing`);
    return clean.replace(agentPattern, (line) => `${line}\n${dumped}`);
  });
  fs.writeFileSync(file, text.slice(0, starts[0] ?? text.length) + out.join(''), 'utf8');
}

function extractObject(raw: string): string { const a = raw.indexOf('{'); const b = raw.lastIndexOf('}'); return a >= 0 && b > a ? raw.slice(a, b + 1) : raw; }
function chunk<T>(values: T[], size: number): T[][] { const out: T[][] = []; for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size)); return out; }
function persist(): void { const temp = `${CHECKPOINT}.tmp`; fs.writeFileSync(temp, JSON.stringify(state)); fs.renameSync(temp, CHECKPOINT); }

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
