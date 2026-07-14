import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getClient } from './redis';
import { loadManifest, getPromptsDir, PromptEntry, Manifest } from './manifest';

const PREFIX = {
  PROMPT: 'prompt:',
  LLM_PROMPT: 'llm_prompt:',
};

export interface SyncResult {
  key: string;
  file: string;
  action: 'created' | 'updated' | 'unchanged';
  llm_id: string | null;
  llm_id_before: string | null;
  chars: number;
}

export interface StatusRow {
  key: string;
  file: string;
  exists: boolean;
  llm_id: string | null;
  inSync: boolean;
}

interface LlmPromptPayload {
  llm_id: string | null;
  prompt_text: string;
  temperature: number;
  version: string | null;
}

// db_to_redis 와 동일한 레거시 키 규칙 (prompt:{type}:{sha256(main:sub)})
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function legacyKey(mainIntent: string, subIntent: string, promptType: string): string {
  const hash = crypto.createHash('sha256').update(normalize(`${mainIntent}:${subIntent}`)).digest('hex');
  return `${PREFIX.PROMPT}${promptType.toLowerCase()}:${hash}`;
}

function llmPromptKey(mainIntent: string, subIntent: string, promptType: string): string {
  return `${PREFIX.LLM_PROMPT}${mainIntent}:${subIntent}:${promptType}`;
}

function parsePayload(raw: string | null): LlmPromptPayload | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LlmPromptPayload;
  } catch {
    return null;
  }
}

function readPromptFile(promptsDir: string, fileName: string): string {
  const text = fs.readFileSync(path.join(promptsDir, fileName), 'utf8');
  if (!text.trim()) throw new Error(`prompt file is empty: ${fileName}`);
  return text;
}

async function syncEntry(
  entry: PromptEntry,
  manifest: Manifest,
  promptsDir: string,
  dryRun: boolean
): Promise<SyncResult[]> {
  const redis = getClient();
  const promptText = readPromptFile(promptsDir, entry.file);
  const llmId = entry.llm_id ?? manifest.defaults?.llm_id ?? null;
  const results: SyncResult[] = [];

  for (const target of entry.targets) {
    const [mainIntent, subIntent] = target.split(':');
    const key = llmPromptKey(mainIntent, subIntent, entry.promptType);
    const existing = parsePayload(await redis.get(key));

    const payload: LlmPromptPayload = {
      llm_id: llmId ?? existing?.llm_id ?? null,
      prompt_text: promptText,
      temperature: entry.temperature ?? manifest.defaults?.temperature ?? existing?.temperature ?? 0,
      version: existing?.version ?? 'local',
    };

    let action: SyncResult['action'];
    if (!existing) action = 'created';
    else if (JSON.stringify(existing) === JSON.stringify(payload)) action = 'unchanged';
    else action = 'updated';

    if (!dryRun && action !== 'unchanged') {
      await redis
        .multi()
        .set(key, JSON.stringify(payload))
        .set(legacyKey(mainIntent, subIntent, entry.promptType), promptText)
        .exec();
    }

    console.log(`[prompt_update] ${action.padEnd(9)} ${key} (llm_id=${payload.llm_id}${dryRun ? ', dry-run' : ''})`);
    results.push({
      key,
      file: entry.file,
      action,
      llm_id: payload.llm_id,
      llm_id_before: existing?.llm_id ?? null,
      chars: promptText.length,
    });
  }

  return results;
}

export async function syncPrompts(fileFilter?: string, dryRun = false): Promise<SyncResult[]> {
  const promptsDir = getPromptsDir();
  const manifest = loadManifest(promptsDir);

  const entries = fileFilter
    ? manifest.prompts.filter((p) => p.file === fileFilter || p.file === `${fileFilter}.md`)
    : manifest.prompts;

  if (fileFilter && entries.length === 0) {
    throw new Error(`no manifest entry for file "${fileFilter}"`);
  }

  const results: SyncResult[] = [];
  for (const entry of entries) {
    results.push(...(await syncEntry(entry, manifest, promptsDir, dryRun)));
  }
  return results;
}

export async function getStatus(): Promise<StatusRow[]> {
  const redis = getClient();
  const promptsDir = getPromptsDir();
  const manifest = loadManifest(promptsDir);
  const rows: StatusRow[] = [];

  for (const entry of manifest.prompts) {
    const promptText = readPromptFile(promptsDir, entry.file);
    for (const target of entry.targets) {
      const [mainIntent, subIntent] = target.split(':');
      const key = llmPromptKey(mainIntent, subIntent, entry.promptType);
      const existing = parsePayload(await redis.get(key));
      rows.push({
        key,
        file: entry.file,
        exists: existing !== null,
        llm_id: existing?.llm_id ?? null,
        inSync: existing?.prompt_text === promptText,
      });
    }
  }
  return rows;
}
