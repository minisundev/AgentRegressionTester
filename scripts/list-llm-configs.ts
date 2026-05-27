import { createRedisClient } from '../src/llm/redis.js';
import type { LLMEndpointConfig } from '../src/types/llm.js';

const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const PATTERN = process.env.LLM_CONFIG_PATTERN ?? 'config:llm:*';

interface Row {
  key: string;
  id: string;
  group: string;
  version: string;
  llm_deploy: string;
  url: string;
  raw: LLMEndpointConfig | undefined;
  error?: string;
}

async function scanKeys(redis: ReturnType<typeof createRedisClient>): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', PATTERN, 'COUNT', 200);
    keys.push(...batch);
    cursor = next;
  } while (cursor !== '0');
  return keys.sort((a, b) => {
    const na = Number(a.split(':').pop());
    const nb = Number(b.split(':').pop());
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

function summarize(key: string, raw: string | null): Row {
  const id = key.split(':').pop() ?? key;
  if (!raw) {
    return { key, id, group: '', version: '', llm_deploy: '', url: '', raw: undefined, error: '(empty)' };
  }
  try {
    const cfg = JSON.parse(raw) as LLMEndpointConfig;
    return {
      key,
      id,
      group: cfg.group ?? '',
      version: cfg.version ?? '',
      llm_deploy: cfg.llm_deploy ?? '',
      url: cfg.url ?? '',
      raw: cfg,
    };
  } catch (e) {
    return {
      key,
      id,
      group: '',
      version: '',
      llm_deploy: '',
      url: '',
      raw: undefined,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function printTable(rows: Row[]): void {
  const headers = ['ID', 'GROUP', 'VERSION', 'LLM_DEPLOY', 'URL'];
  const widths = headers.map((h) => h.length);
  const data = rows.map((r) => [r.id, r.group, r.version, r.llm_deploy, r.error ? `! ${r.error}` : r.url]);

  for (const row of data) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, String(cell).length);
    });
  }

  const fmt = (cells: string[]) =>
    cells.map((cell, i) => String(cell).padEnd(widths[i] ?? 0)).join('  ');

  console.log(fmt(headers));
  console.log(fmt(widths.map((w) => '-'.repeat(w))));
  for (const row of data) {
    console.log(fmt(row.map(String)));
  }
}

async function main(): Promise<void> {
  const redis = createRedisClient();
  await redis.connect();

  const target = process.env.REDIS_URL
    ? process.env.REDIS_URL.replace(/:[^:@/]+@/, ':***@')
    : `${process.env.REDIS_ENDPOINT ?? '127.0.0.1'}:${process.env.REDIS_PORT ?? '6379'}`;
  console.log(`[redis] connected to ${target}`);
  console.log(`[redis] scanning ${PATTERN}\n`);

  try {
    const keys = await scanKeys(redis);
    if (keys.length === 0) {
      console.log('No keys matched.');
      return;
    }

    const raws = await Promise.all(keys.map((k) => redis.get(k)));
    const rows = keys.map((k, i) => summarize(k, raws[i] ?? null));

    printTable(rows);

    if (VERBOSE) {
      console.log('\n--- full payloads ---');
      for (const row of rows) {
        console.log(`\n${row.key}:`);
        console.log(JSON.stringify(row.raw ?? row.error, null, 2));
      }
    }

    console.log(`\n[redis] ${rows.length} key(s)`);
  } finally {
    redis.disconnect();
  }
}

main().catch((error) => {
  console.error(`[list-llm-configs] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
