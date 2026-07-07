import crypto from 'crypto';
import { mset, delByPattern } from './db/redis';
import { getCacheData, getPromptData, getLlmData } from './db/pg';

const PREFIX = {
  CACHE: 'utter:',
  PROMPT: 'prompt:',
  LLM_PROMPT: 'llm_prompt:',
  LLM: 'config:llm:',
};

const LLM_AUTH_KEY_MAP: Record<string, string | undefined> = {
  GPT4: process.env.LLM_GPT_4O_API_KEY,
  GEMMA: process.env.LLM_GEMMA_API_KEY,
  CLAUDE: process.env.LLM_CLAUDE_API_KEY,
};

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeAndHash(text: string): string {
  return crypto.createHash('sha256').update(normalize(text)).digest('hex');
}

function makeLlmPromptKey(mainIntent: string, subIntent: string, promptType: string): string {
  return `${PREFIX.LLM_PROMPT}${mainIntent}:${subIntent}:${promptType}`;
}

export async function syncCache(key?: string, delExists = false): Promise<number> {
  const rows = await getCacheData(key);
  const o: Record<string, string> = {};
  const keys: string[] = [];

  for (const row of rows) {
    const k = `${PREFIX.CACHE}${row.utter_hash}`;
    keys.push(k);
    o[k] = JSON.stringify(row);
    console.log(`cache key : ${k}`);
  }

  await mset(o);

  if (delExists) {
    const deleted = await delByPattern(PREFIX.CACHE + '*', keys);
    console.log(`deleted ${deleted} old cache keys`);
  }

  return rows.length;
}

export async function syncPrompt(key?: string, delExists = false): Promise<number> {
  const rows = await getPromptData(key);
  const o: Record<string, string> = {};
  const keys: string[] = [];
  const oldKeys: string[] = [];

  for (const row of rows) {
    const intent = normalizeAndHash(row.main_intent_code + ':' + row.sub_intent_code);
    const oldKey = `${PREFIX.PROMPT}${row.prompt_type_cd.toLowerCase()}:${intent}`;
    oldKeys.push(oldKey);
    o[oldKey] = row.prompt_text;

    const newKey = makeLlmPromptKey(row.main_intent_code, row.sub_intent_code, row.prompt_type_cd);
    keys.push(newKey);
    o[newKey] = JSON.stringify({
      llm_id: row.llm_id,
      prompt_text: row.prompt_text,
      temperature: Number(row.temperature) || 0,
      version: row.version,
    });

    console.log(`prompt key : ${oldKey}`);
    console.log(`prompt key : ${newKey}`);
  }

  await mset(o);

  if (delExists) {
    const deleted = await delByPattern(PREFIX.LLM_PROMPT + '*', keys);
    console.log(`deleted ${deleted} old llm_prompt keys`);
    const deletedOld = await delByPattern(PREFIX.PROMPT + '*', oldKeys);
    console.log(`deleted ${deletedOld} old prompt keys`);
  }

  return rows.length;
}

export async function syncLlm(llmId?: string, delExists = false): Promise<number> {
  const rows = await getLlmData(llmId);
  const o: Record<string, string> = {};
  const keys: string[] = [];

  for (const row of rows) {
    const key = `${PREFIX.LLM}${row.llm_id}`;
    keys.push(key);
    o[key] = JSON.stringify({
      url: row.endpoint_url,
      group: row.llm_group,
      version: row.model_version,
      auth_key: LLM_AUTH_KEY_MAP[row.llm_group] ?? null,
      llm_deploy: row.llm_deploy,
    });
    console.log(`llm config key : ${key}`);
  }

  if (rows.length > 0) {
    await mset(o);

    if (delExists) {
      const deleted = await delByPattern(PREFIX.LLM + '*', keys);
      console.log(`deleted ${deleted} old llm keys`);
    }
  }

  return rows.length;
}
