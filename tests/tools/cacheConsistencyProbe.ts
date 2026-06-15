/**
 * Gateway weather-cache consistency probe.
 *
 * Hits the api-gateway-core weather endpoints DIRECTLY (agent bypassed) with
 * several q-spellings of the same city, then proves whether the gateway cache
 * is keyed on the raw q string instead of the resolved GeoDB city id.
 *
 * Evidence captured per call: wall-clock, q, endpoint, city id, coord, dt
 * (observation time + staleness), temp, humidity, and the X-Cache / CF-Cache /
 * Age response headers. Each round compares spellings: same id but different
 * dt == cache fragmentation (DIVERGENCE). Same q frozen across rounds == cache
 * hit (vs. real-time noise, which would wobble).
 *
 * Output goes to the terminal (stdout) ONLY — never to a file. A file the tool
 * writes itself could be edited after the fact, so it is worthless as evidence;
 * the live terminal capture / screenshot is the proof. Pipe to `tee` yourself if
 * you want a copy, but the tool stays the untouched source.
 *
 * Run:  npx tsx tests/tools/cacheConsistencyProbe.ts
 * Config is read from env (see CONFIG below); CONTROL_BASE_URL supplies the host.
 */

import 'dotenv/config';
import axios from 'axios';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function deriveGatewayBase(): string {
  const explicit = process.env.CACHE_PROBE_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const control = process.env.CONTROL_BASE_URL?.trim();
  if (!control) {
    throw new Error('Set CACHE_PROBE_BASE_URL or CONTROL_BASE_URL so the gateway host can be derived.');
  }
  const origin = new URL(control).origin; // keep scheme + host from the control URL
  return `${origin}/api-gateway-core/v1/external/weather`;
}

function splitList(value: string | undefined, separator: string, fallback: string[]): string[] {
  if (!value) return fallback;
  const items = value.split(separator).map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

const CONFIG = {
  baseUrl: deriveGatewayBase(),
  // q-spellings are pipe-separated because each value itself contains a comma (e.g. "Hà Nội,VN").
  queries: splitList(process.env.CACHE_PROBE_QUERIES, '|', ['Hà Nội,VN', 'hanoi,VN', 'Hanoi,VN']),
  endpoints: splitList(process.env.CACHE_PROBE_ENDPOINTS, ',', ['current']),
  rounds: Number(process.env.CACHE_PROBE_ROUNDS ?? '15'),
  intervalSec: Number(process.env.CACHE_PROBE_INTERVAL_SEC ?? '60'),
  repeat: Number(process.env.CACHE_PROBE_REPEAT ?? '2'), // calls per q per round (1st=MISS/populate, 2nd=HIT)
  cnt: Number(process.env.CACHE_PROBE_CNT ?? '1'),
  language: process.env.CACHE_PROBE_LANG ?? 'en',
  stopOnDivergence: process.env.CACHE_PROBE_STOP_ON_DIVERGENCE === '1',
  apiKey: process.env.X_API_KEY?.trim(),
};

// ---------------------------------------------------------------------------
// Logger (terminal/stdout only — no file, so the output can't be tampered with)
// ---------------------------------------------------------------------------

function log(line = ''): void {
  console.log(line);
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

interface ProbeSample {
  round: number;
  attempt: number;
  wallClock: number; // epoch seconds at request time
  q: string;
  endpoint: string;
  status: number;
  id?: number;
  name?: string;
  lon?: number;
  lat?: number;
  dt?: number;
  tzOffsetSec?: number;
  temp?: number;
  humidity?: number;
  xCache?: string;
  cfCache?: string;
  age?: string;
  sentTxId?: string; // transactionId WE sent (greppable in gateway logs)
  respTxId?: string; // transactionId / traceId the gateway returned, if any
  error?: string;
}

/**
 * Pulls id / coord / dt / temp / humidity out of a gateway weather payload.
 * Handles the OpenWeather-style `current` shape and falls back to `list[0]`
 * for hourly / daily responses.
 */
function extractFields(payload: unknown): Partial<ProbeSample> {
  if (!payload || typeof payload !== 'object') return {};
  const root = payload as Record<string, any>;
  const node = root.dt !== undefined ? root : Array.isArray(root.list) ? root.list[0] ?? {} : root;
  const coord = node.coord ?? root.coord ?? {};
  const main = node.main ?? {};
  return {
    id: root.id ?? node.id,
    name: root.name ?? node.name,
    lon: coord.lon,
    lat: coord.lat,
    dt: node.dt,
    tzOffsetSec: root.timezone ?? node.timezone,
    temp: main.temp,
    humidity: main.humidity,
    respTxId: root.transactionId ?? root.trxId ?? root.traceId,
  };
}

// Response-side trace/transaction id the gateway team can grep in their own logs.
const TX_HEADER_KEYS = ['transactionid', 'x-transaction-id', 'traceid', 'x-trace-id', 'x-request-id', 'x-amzn-trace-id'];

async function probe(endpoint: string, q: string, round: number, attempt: number): Promise<ProbeSample> {
  const url = `${CONFIG.baseUrl}/${endpoint}`;
  const wallClock = Math.floor(Date.now() / 1000);

  const sentTxId = `cacheprobe-${randomUUID()}`;
  const sample: ProbeSample = { round, attempt, wallClock, q, endpoint, status: 0, sentTxId };

  try {
    const res = await axios.get(url, {
      params: { q, cnt: CONFIG.cnt },
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': CONFIG.language,
        requestId: randomUUID(),
        transactionId: sentTxId,
        ...(CONFIG.apiKey ? { 'x-api-key': CONFIG.apiKey } : {}),
      },
      timeout: 20_000,
      validateStatus: () => true,
    });

    sample.status = res.status;
    sample.xCache = headerValue(res.headers, 'x-cache');
    sample.cfCache = headerValue(res.headers, 'cf-cache-status');
    sample.age = headerValue(res.headers, 'age');
    const bodyFields = extractFields(res.data);
    Object.assign(sample, bodyFields);
    // Prefer a trace id echoed in headers; fall back to one in the body.
    sample.respTxId = TX_HEADER_KEYS.map((k) => headerValue(res.headers, k)).find(Boolean) ?? bodyFields.respTxId;
  } catch (err) {
    sample.error = err instanceof Error ? err.message : String(err);
  }

  return sample;
}

function headerValue(headers: Record<string, unknown>, key: string): string | undefined {
  const v = headers[key];
  if (v === undefined || v === null) return undefined;
  return Array.isArray(v) ? v.join(',') : String(v);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtLocal(dt?: number, tzOffsetSec?: number): string {
  if (dt === undefined) return '-';
  const d = new Date((dt + (tzOffsetSec ?? 0)) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function pad(value: unknown, width: number): string {
  const s = value === undefined || value === null ? '-' : String(value);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function renderTable(samples: ProbeSample[]): void {
  const header = [
    pad('wall(utc)', 11), pad('q', 12), pad('attempt', 8), pad('status', 7),
    pad('id', 9), pad('coord', 19), pad('dt(local)', 11), pad('stale', 9),
    pad('temp', 7), pad('hum', 5), pad('X-Cache', 9), pad('Age', 5),
  ].join(' | ');
  log(header);
  log('-'.repeat(header.length));

  for (const s of samples) {
    const now = s.wallClock;
    const stale = s.dt !== undefined ? `${now - s.dt}s` : '-';
    const wall = fmtLocal(now, s.tzOffsetSec);
    const coord = s.lon !== undefined ? `${s.lon},${s.lat}` : '-';
    log([
      pad(wall, 11),
      pad(s.q, 12),
      pad(`${s.attempt}/${CONFIG.repeat}`, 8),
      pad(s.error ? 'ERR' : s.status, 7),
      pad(s.id, 9),
      pad(coord, 19),
      pad(fmtLocal(s.dt, s.tzOffsetSec), 11),
      pad(stale, 9),
      pad(s.temp, 7),
      pad(s.humidity, 5),
      pad(s.xCache ?? (s.attempt === 1 ? 'MISS?' : '-'), 9),
      pad(s.age, 5),
    ].join(' | ') + (s.error ? `   ! ${s.error}` : ''));
  }
}

// Full transaction/trace ids so the gateway team can grep the exact call in
// their own logs. Sent id = the transactionId we put on the request (always
// present); resp id = a trace id echoed back in headers/body (if any).
function renderTraceIds(samples: ProbeSample[]): void {
  log('');
  log('  trace ids (grep in gateway logs):');
  for (const s of samples) {
    log(`    q="${s.q}" ${s.attempt}/${CONFIG.repeat}  sent=${s.sentTxId ?? '-'}  resp=${s.respTxId ?? '(none in response)'}`);
  }
}

// ---------------------------------------------------------------------------
// Divergence analysis
// ---------------------------------------------------------------------------

interface RoundVerdict {
  diverged: boolean;
  details: string[];
}

function analyzeRound(samples: ProbeSample[]): RoundVerdict {
  const details: string[] = [];
  let diverged = false;

  for (const endpoint of CONFIG.endpoints) {
    // Use the freshest sample observed per q this round (last attempt).
    const perQ = new Map<string, ProbeSample>();
    for (const s of samples) {
      if (s.endpoint !== endpoint || s.dt === undefined || s.id === undefined) continue;
      perQ.set(s.q, s);
    }
    if (perQ.size < 2) continue;

    // Group queries by resolved city id; within an id, distinct dt == fragmentation.
    const byId = new Map<number, ProbeSample[]>();
    for (const s of perQ.values()) {
      const arr = byId.get(s.id!) ?? [];
      arr.push(s);
      byId.set(s.id!, arr);
    }

    for (const [id, group] of byId) {
      const distinctDt = new Set(group.map((s) => s.dt));
      if (distinctDt.size > 1) {
        diverged = true;
        const dts = [...group].sort((a, b) => a.dt! - b.dt!);
        const oldest = dts[0].dt!;
        const newest = dts[dts.length - 1].dt!;
        const gap = newest - oldest;
        details.push(
          `  [${endpoint}] DIVERGENCE on id=${id}: ${distinctDt.size} distinct dt across spellings, gap=${gap}s (${(gap / 60).toFixed(1)}min)`,
        );
        for (const s of dts) {
          details.push(
            `      q="${s.q}" dt=${s.dt} (${fmtLocal(s.dt, s.tzOffsetSec)}) temp=${s.temp} hum=${s.humidity} coord=${s.lon},${s.lat} X-Cache=${s.xCache ?? '-'} tx[sent=${s.sentTxId ?? '-'} resp=${s.respTxId ?? '-'}]`,
          );
        }
      } else if (group.length > 1) {
        details.push(
          `  [${endpoint}] aligned on id=${id}: ${group.length} spellings share dt=${[...distinctDt][0]} (${fmtLocal([...distinctDt][0], group[0].tzOffsetSec)}) — no fragmentation this round`,
        );
      }
    }
  }

  return { diverged, details };
}

// Tracks per (endpoint|q) dt across rounds to expose frozen vs. refreshed cache.
const lastDt = new Map<string, number>();

function reportFrozen(samples: ProbeSample[]): void {
  for (const s of samples) {
    if (s.dt === undefined) continue;
    if (s.attempt !== CONFIG.repeat) continue; // only track the last attempt per round
    const trackKey = `${s.endpoint}|${s.q}`;
    const prev = lastDt.get(trackKey);
    if (prev !== undefined) {
      if (prev === s.dt) {
        log(`  frozen: [${s.endpoint}] q="${s.q}" dt still ${s.dt} (${fmtLocal(s.dt, s.tzOffsetSec)}) — cache, not live`);
      } else {
        log(`  refreshed: [${s.endpoint}] q="${s.q}" dt ${prev} -> ${s.dt} (jump ${s.dt - prev}s) — TTL boundary crossed`);
      }
    }
    lastDt.set(trackKey, s.dt);
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const sleep = (sec: number) => new Promise((resolve) => setTimeout(resolve, sec * 1000));

async function main(): Promise<void> {
  log('='.repeat(96));
  log('Gateway Weather-Cache Consistency Probe');
  log('='.repeat(96));
  const infinite = CONFIG.rounds <= 0; // ROUNDS=0 (or less) => poll forever
  log(`baseUrl        : ${CONFIG.baseUrl}`);
  log(`queries        : ${CONFIG.queries.map((q) => `"${q}"`).join(', ')}`);
  log(`endpoints      : ${CONFIG.endpoints.join(', ')}`);
  log(`rounds         : ${infinite ? '∞ (until Ctrl+C' + (CONFIG.stopOnDivergence ? ' or first divergence)' : ')') : CONFIG.rounds}  interval=${CONFIG.intervalSec}s  repeat=${CONFIG.repeat}/q`);
  log(`stopOnDiverge  : ${CONFIG.stopOnDivergence}`);
  log(`x-api-key      : ${CONFIG.apiKey ? 'sent' : 'not set'}`);
  log(`output         : terminal only (no file — capture/screenshot the terminal for evidence)`);
  log('');

  let divergedRounds = 0;
  let round = 0;

  while (infinite || round < CONFIG.rounds) {
    round++;
    const total = infinite ? '∞' : CONFIG.rounds;
    const samples: ProbeSample[] = [];

    // Fixed order: endpoint -> q -> repeat, so the table reads spelling-by-spelling.
    for (const endpoint of CONFIG.endpoints) {
      for (const q of CONFIG.queries) {
        for (let attempt = 1; attempt <= CONFIG.repeat; attempt++) {
          samples.push(await probe(endpoint, q, round, attempt));
        }
      }
    }

    log('');
    log(`───── Round ${round}/${total}  @ ${new Date().toISOString()} ─────`);
    renderTable(samples);
    renderTraceIds(samples);

    const verdict = analyzeRound(samples);
    if (verdict.diverged) {
      divergedRounds++;
      log('');
      log('  *** CACHE FRAGMENTATION DETECTED ***');
    }
    if (verdict.details.length > 0) {
      log('');
      verdict.details.forEach((d) => log(d));
    }
    reportFrozen(samples);

    if (verdict.diverged && CONFIG.stopOnDivergence) {
      log('');
      log('Stopping early (CACHE_PROBE_STOP_ON_DIVERGENCE=1).');
      break;
    }

    if (infinite || round < CONFIG.rounds) {
      await sleep(CONFIG.intervalSec);
    }
  }

  log('');
  log('='.repeat(96));
  log(`DONE. Rounds with cache fragmentation: ${divergedRounds}/${round}`);
  log(divergedRounds > 0
    ? 'Verdict: same city id served different dt across q-spellings => cache keyed on raw q. Attach this log.'
    : 'Verdict: no fragmentation captured this run. Divergence is intermittent (TTL boundaries); re-run / lengthen rounds.');
  log('='.repeat(96));
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
