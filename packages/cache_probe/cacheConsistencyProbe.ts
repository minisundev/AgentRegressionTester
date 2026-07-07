/**
 * Gateway weather-cache consistency probe.
 *
 * Hits the api-gateway-core weather endpoints DIRECTLY (agent bypassed) with
 * several q-spellings of the same city, then proves whether the gateway cache
 * is keyed on the raw q string instead of the resolved GeoDB city id.
 *
 * Evidence captured per call: wall-clock, q, endpoint, city id / coord, dt,
 * normalized weather fingerprint, temp, humidity, and the X-Cache / CF-Cache /
 * Age response headers. Each round compares spellings: same location but
 * different dt or fingerprint == cache fragmentation (DIVERGENCE). Same q
 * frozen across rounds == cache hit (vs. real-time noise, which would wobble).
 *
 * Output goes to the terminal (stdout) ONLY — never to a file. A file the tool
 * writes itself could be edited after the fact, so it is worthless as evidence;
 * the live terminal capture / screenshot is the proof. Pipe to `tee` yourself if
 * you want a copy, but the tool stays the untouched source.
 *
 * Run:  npx tsx packages/cache_probe/cacheConsistencyProbe.ts
 * Config is read from env (see CONFIG below); CONTROL_BASE_URL supplies the host.
 */

import 'dotenv/config';
import axios from 'axios';
import { google } from 'googleapis';
import { createHash, randomUUID } from 'node:crypto';

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

const DEFAULT_ENDPOINTS = [
  'current',
  'hourly',
  'daily',
  'air-quality/current',
  'air-quality/forecast',
];

function splitEndpoints(value: string | undefined): string[] {
  const endpoints = splitList(value, ',', DEFAULT_ENDPOINTS);
  if (endpoints.length === 1 && endpoints[0].toLowerCase() === 'all') return DEFAULT_ENDPOINTS;
  return endpoints;
}

const CONFIG = {
  baseUrl: deriveGatewayBase(),
  // q-spellings are pipe-separated because each value itself contains a comma (e.g. "Hà Nội,VN").
  queries: splitList(process.env.CACHE_PROBE_QUERIES, '|', ['Hà Nội,VN', 'hanoi,VN', 'Hanoi,VN']),
  endpoints: splitEndpoints(process.env.CACHE_PROBE_ENDPOINTS),
  rounds: Number(process.env.CACHE_PROBE_ROUNDS ?? '15'),
  intervalSec: Number(process.env.CACHE_PROBE_INTERVAL_SEC ?? '60'),
  repeat: Number(process.env.CACHE_PROBE_REPEAT ?? '2'), // calls per q per round (1st=MISS/populate, 2nd=HIT)
  cnt: Number(process.env.CACHE_PROBE_CNT ?? '1'),
  language: process.env.CACHE_PROBE_LANG ?? 'en',
  stopOnDivergence: process.env.CACHE_PROBE_STOP_ON_DIVERGENCE === '1',
  dumpBody: process.env.CACHE_PROBE_DUMP_BODY === '1',
  sheetEnabled: process.env.CACHE_PROBE_SHEET !== '0',
  sheetTab: process.env.CACHE_PROBE_SHEET_TAB ?? 'WeatherCacheProbe',
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
  fingerprint?: string;
  xCache?: string;
  cfCache?: string;
  age?: string;
  sentTxId?: string; // transactionId WE sent (greppable in gateway logs)
  respTxId?: string; // transactionId / traceId the gateway returned, if any
  bodyHint?: string;
  error?: string;
}

/**
 * Pulls comparable fields out of gateway weather payloads. `current` exposes a
 * live observation dt, while forecast-style responses expose future slot dt
 * values; the fingerprint catches value drift even when the slot dt is equal.
 */
function extractFields(payload: unknown): Partial<ProbeSample> {
  const root = unwrapPayload(payload);
  if (!root) return {};
  const node = root.dt !== undefined
    ? root
    : root.current && typeof root.current === 'object'
    ? root.current
    : Array.isArray(root.list)
    ? root.list[0] ?? {}
    : root;
  const city = root.city ?? {};
  const coord = node.coord ?? root.coord ?? city.coord ?? { lon: root.lon, lat: root.lat };
  const main = node.main ?? {};
  return {
    id: root.id ?? city.id ?? node.id,
    name: root.name ?? city.name ?? node.name,
    lon: coord.lon,
    lat: coord.lat,
    dt: node.dt,
    tzOffsetSec: root.timezone ?? city.timezone ?? node.timezone,
    temp: firstNumber(main.temp, node.temp?.day, node.temp),
    humidity: main.humidity,
    fingerprint: fingerprintPayload(root),
    respTxId: root.transactionId ?? root.trxId ?? root.traceId,
  };
}

function unwrapPayload(payload: unknown): Record<string, any> | undefined {
  if (Array.isArray(payload)) return { list: payload };
  if (!payload || typeof payload !== 'object') return undefined;

  let current = payload as Record<string, any>;
  for (let depth = 0; depth < 4; depth++) {
    const next = ['data', 'result', 'response', 'body', 'payload']
      .map((key) => current[key])
      .find((value) => value && typeof value === 'object');

    if (!next) break;
    if (Array.isArray(next)) return { list: next };
    current = next as Record<string, any>;
  }

  return current;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function fingerprintPayload(root: Record<string, any>): string | undefined {
  const comparable = cleanComparable(comparablePayload(root));
  if (comparable === undefined) return undefined;
  return createHash('sha1').update(JSON.stringify(comparable)).digest('hex').slice(0, 12);
}

function comparablePayload(root: Record<string, any>): unknown {
  const city = root.city ?? {};
  const coord = root.coord ?? city.coord ?? { lon: root.lon, lat: root.lat };

  if (Array.isArray(root.list)) {
    return {
      city: root.id ?? city.id ?? city.name,
      coord: normalizeCoord(coord),
      list: root.list.slice(0, 6).map((item: Record<string, any>) => comparableWeatherNode(item)),
    };
  }

  if (root.current || Array.isArray(root.hourly) || Array.isArray(root.daily)) {
    return {
      city: root.id ?? city.id ?? city.name,
      coord: normalizeCoord(coord),
      current: root.current ? comparableWeatherNode(root.current) : undefined,
      hourly: Array.isArray(root.hourly)
        ? root.hourly.slice(0, 6).map((item: Record<string, any>) => comparableWeatherNode(item))
        : undefined,
      daily: Array.isArray(root.daily)
        ? root.daily.slice(0, 6).map((item: Record<string, any>) => comparableWeatherNode(item))
        : undefined,
    };
  }

  return {
    city: root.id ?? root.name,
    coord: normalizeCoord(coord),
    current: comparableWeatherNode(root),
  };
}

function cleanComparable(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    const items = value.map(cleanComparable).filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => [key, cleanComparable(child)] as const)
    .filter(([, child]) => child !== undefined);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function comparableWeatherNode(node: Record<string, any>): unknown {
  const main = node.main ?? {};
  const weather = Array.isArray(node.weather) ? node.weather.map((w: Record<string, any>) => w.id ?? w.main) : undefined;
  return {
    dt: node.dt,
    temp: roundNumber(firstNumber(main.temp, node.temp?.day, node.temp)),
    tempMin: roundNumber(main.temp_min),
    tempMax: roundNumber(main.temp_max),
    humidity: main.humidity ?? node.humidity,
    pressure: main.pressure,
    pop: roundNumber(node.pop),
    rain: node.rain,
    snow: node.snow,
    weather,
    aqi: node.main?.aqi,
    components: comparableAirComponents(node.components),
  };
}

function comparableAirComponents(components: unknown): unknown {
  if (!components || typeof components !== 'object') return undefined;
  const c = components as Record<string, unknown>;
  return {
    pm2_5: roundNumber(c.pm2_5),
    pm10: roundNumber(c.pm10),
    no2: roundNumber(c.no2),
    o3: roundNumber(c.o3),
  };
}

function normalizeCoord(coord: unknown): unknown {
  if (!coord || typeof coord !== 'object') return undefined;
  const c = coord as Record<string, unknown>;
  return {
    lon: roundNumber(c.lon, 4),
    lat: roundNumber(c.lat, 4),
  };
}

function roundNumber(value: unknown, digits = 2): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
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
    if (CONFIG.dumpBody && sampleSignature(sample) === undefined) {
      sample.bodyHint = summarizeBody(res.data);
    }
    // Prefer a trace id echoed in headers; fall back to one in the body.
    sample.respTxId = TX_HEADER_KEYS.map((k) => headerValue(res.headers, k)).find(Boolean) ?? bodyFields.respTxId;
  } catch (err) {
    sample.error = err instanceof Error ? err.message : String(err);
  }

  return sample;
}

function summarizeBody(body: unknown): string {
  try {
    return JSON.stringify(body).slice(0, 500);
  } catch {
    return String(body).slice(0, 500);
  }
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
    pad('wall(utc)', 11), pad('endpoint', 14), pad('q', 12), pad('attempt', 8), pad('status', 7),
    pad('id', 9), pad('coord', 19), pad('dt(local)', 11), pad('stale', 9),
    pad('temp', 7), pad('hum', 5), pad('fp', 12), pad('X-Cache', 9), pad('Age', 5),
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
      pad(s.endpoint, 14),
      pad(s.q, 12),
      pad(`${s.attempt}/${CONFIG.repeat}`, 8),
      pad(s.error ? 'ERR' : s.status, 7),
      pad(s.id, 9),
      pad(coord, 19),
      pad(fmtLocal(s.dt, s.tzOffsetSec), 11),
      pad(stale, 9),
      pad(s.temp, 7),
      pad(s.humidity, 5),
      pad(s.fingerprint, 12),
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
    log(`    [${s.endpoint}] q="${s.q}" ${s.attempt}/${CONFIG.repeat}  sent=${s.sentTxId ?? '-'}  resp=${s.respTxId ?? '(none in response)'}`);
  }
}

function renderBodyHints(samples: ProbeSample[]): void {
  const withHints = samples.filter((s) => s.bodyHint);
  if (withHints.length === 0) return;

  log('');
  log('  body hints (CACHE_PROBE_DUMP_BODY=1; parser found no weather fields):');
  for (const s of withHints) {
    log(`    [${s.endpoint}] q="${s.q}" ${s.attempt}/${CONFIG.repeat} status=${s.status} body=${s.bodyHint}`);
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
      if (s.endpoint !== endpoint || locationKey(s) === undefined || sampleSignature(s) === undefined) continue;
      perQ.set(s.q, s);
    }
    if (perQ.size < 2) continue;

    // Group queries by resolved location; within a location, distinct snapshots
    // across q-spellings indicate cache fragmentation.
    const byLocation = new Map<string, ProbeSample[]>();
    for (const s of perQ.values()) {
      const key = locationKey(s)!;
      const arr = byLocation.get(key) ?? [];
      arr.push(s);
      byLocation.set(key, arr);
    }

    for (const [key, group] of byLocation) {
      const distinctDt = new Set(group.map((s) => s.dt));
      const distinctSnapshot = new Set(group.map(sampleSignature));
      if (distinctSnapshot.size > 1) {
        diverged = true;
        const dts = [...group].sort((a, b) => (a.dt ?? 0) - (b.dt ?? 0));
        const knownDts = dts.map((s) => s.dt).filter((dt): dt is number => dt !== undefined);
        const gap = knownDts.length > 0 ? Math.max(...knownDts) - Math.min(...knownDts) : 0;
        details.push(
          `  [${endpoint}] DIVERGENCE on ${key}: ${distinctSnapshot.size} distinct snapshots across spellings, dt_count=${distinctDt.size}, dt_gap=${gap}s (${(gap / 60).toFixed(1)}min)`,
        );
        for (const s of dts) {
          details.push(
            `      q="${s.q}" dt=${s.dt ?? '-'} (${fmtLocal(s.dt, s.tzOffsetSec)}) temp=${s.temp} hum=${s.humidity} fp=${s.fingerprint ?? '-'} coord=${s.lon},${s.lat} X-Cache=${s.xCache ?? '-'} tx[sent=${s.sentTxId ?? '-'} resp=${s.respTxId ?? '-'}]`,
          );
        }
      } else if (group.length > 1) {
        const firstDt = group[0].dt;
        details.push(
          `  [${endpoint}] aligned on ${key}: ${group.length} spellings share dt=${firstDt ?? '-'} (${fmtLocal(firstDt, group[0].tzOffsetSec)}) fp=${group[0].fingerprint ?? '-'} — no fragmentation this round`,
        );
      }
    }
  }

  return { diverged, details };
}

function locationKey(s: ProbeSample): string | undefined {
  if (s.id !== undefined) return `id=${s.id}`;
  if (s.lon !== undefined && s.lat !== undefined) return `coord=${roundNumber(s.lon, 4)},${roundNumber(s.lat, 4)}`;
  if (s.name) return `name=${s.name}`;
  return undefined;
}

function sampleSignature(s: ProbeSample): string | undefined {
  if (s.dt === undefined && s.fingerprint === undefined) return undefined;
  return `dt=${s.dt ?? '-'};fp=${s.fingerprint ?? '-'}`;
}

interface LastSnapshot {
  dt?: number;
  fingerprint?: string;
}

// Tracks per (endpoint|q) snapshot across rounds to expose frozen vs. refreshed cache.
const lastSnapshot = new Map<string, LastSnapshot>();

function reportFrozen(samples: ProbeSample[]): void {
  for (const s of samples) {
    if (sampleSignature(s) === undefined) continue;
    if (s.attempt !== CONFIG.repeat) continue; // only track the last attempt per round
    const trackKey = `${s.endpoint}|${s.q}`;
    const prev = lastSnapshot.get(trackKey);
    if (prev !== undefined) {
      if (prev.dt === s.dt && prev.fingerprint === s.fingerprint) {
        log(`  frozen: [${s.endpoint}] q="${s.q}" dt still ${s.dt ?? '-'} (${fmtLocal(s.dt, s.tzOffsetSec)}) fp=${s.fingerprint ?? '-'} — cache, not live`);
      } else {
        const jump = prev.dt !== undefined && s.dt !== undefined ? ` (jump ${s.dt - prev.dt}s)` : '';
        log(`  refreshed: [${s.endpoint}] q="${s.q}" dt ${prev.dt ?? '-'} -> ${s.dt ?? '-'} fp ${prev.fingerprint ?? '-'} -> ${s.fingerprint ?? '-'}${jump} — TTL boundary crossed or source data changed`);
      }
    }
    lastSnapshot.set(trackKey, { dt: s.dt, fingerprint: s.fingerprint });
  }
}

// ---------------------------------------------------------------------------
// Google Sheets append
// ---------------------------------------------------------------------------

const SHEET_HEADERS = [
  'Run ID',
  'Round',
  'Captured At',
  'Endpoint',
  'Query',
  'Attempt',
  'HTTP Status',
  'Location Key',
  'City ID',
  'Name',
  'Coord',
  'dt',
  'dt Local',
  'Stale Seconds',
  'Temp',
  'Humidity',
  'Fingerprint',
  'X-Cache',
  'CF-Cache',
  'Age',
  'Sent Tx ID',
  'Resp Tx ID',
  'Round Diverged',
  'Round Details',
  'Error',
];

function sheetRange(sheetTab: string, range: string): string {
  return `'${sheetTab.replace(/'/g, "''")}'!${range}`;
}

async function appendRoundToSheet(runId: string, samples: ProbeSample[], verdict: RoundVerdict): Promise<void> {
  if (!CONFIG.sheetEnabled) return;

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  if (!spreadsheetId || !clientEmail || !privateKey) {
    log('  sheet: missing GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY; skipped');
    return;
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    await ensureProbeSheetExists(sheets, spreadsheetId);

    const header = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetRange(CONFIG.sheetTab, '1:1'),
    });
    const currentHeader = header.data.values?.[0]?.map(String) ?? [];
    const headerMatches = SHEET_HEADERS.every((label, index) => currentHeader[index] === label)
      && currentHeader.length === SHEET_HEADERS.length;

    if (!headerMatches) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: sheetRange(CONFIG.sheetTab, `A1:${columnLetter(SHEET_HEADERS.length - 1)}1`),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [SHEET_HEADERS] },
      });
    }

    const details = verdict.details.join('\n');
    const rows = samples.map((s) => [
      runId,
      s.round,
      new Date(s.wallClock * 1000).toISOString(),
      s.endpoint,
      s.q,
      `${s.attempt}/${CONFIG.repeat}`,
      s.status,
      locationKey(s) ?? '',
      s.id ?? '',
      s.name ?? '',
      s.lon !== undefined && s.lat !== undefined ? `${s.lon},${s.lat}` : '',
      s.dt ?? '',
      fmtLocal(s.dt, s.tzOffsetSec),
      s.dt !== undefined ? s.wallClock - s.dt : '',
      s.temp ?? '',
      s.humidity ?? '',
      s.fingerprint ?? '',
      s.xCache ?? '',
      s.cfCache ?? '',
      s.age ?? '',
      s.sentTxId ?? '',
      s.respTxId ?? '',
      verdict.diverged ? 'Y' : 'N',
      details,
      s.error ?? '',
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetRange(CONFIG.sheetTab, 'A1'),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    log(`  sheet: appended ${rows.length} rows to "${CONFIG.sheetTab}"`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`  sheet: append failed: ${message}`);
  }
}

async function ensureProbeSheetExists(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
): Promise<void> {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(title))',
  });
  const exists = spreadsheet.data.sheets?.some((sheet) => sheet.properties?.title === CONFIG.sheetTab);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: CONFIG.sheetTab },
          },
        },
      ],
    },
  });
  log(`  sheet: created "${CONFIG.sheetTab}"`);
}

function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
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
  log(`sheet          : ${CONFIG.sheetEnabled ? CONFIG.sheetTab : 'disabled'}`);
  log(`x-api-key      : ${CONFIG.apiKey ? 'sent' : 'not set'}`);
  log(`output         : terminal only (no file — capture/screenshot the terminal for evidence)`);
  log('');

  const runId = `cacheprobe-${new Date().toISOString()}`;
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
    renderBodyHints(samples);

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
    await appendRoundToSheet(runId, samples, verdict);

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
