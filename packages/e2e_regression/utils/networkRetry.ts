import axios from 'axios';

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNABORTED',
  'ENETUNREACH',
  'ENETDOWN',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'EPIPE',
]);

export function isNetworkError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) {
    return isNodeNetworkError(err);
  }

  if (err.response) {
    return false;
  }

  if (err.code && NETWORK_ERROR_CODES.has(err.code)) {
    return true;
  }

  return Boolean(err.request);
}

function isNodeNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
}

interface RetryOptions {
  label?: string;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export async function withNetworkRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const label = opts.label ?? 'request';
  const initial = opts.initialDelayMs ?? 5_000;
  const max = opts.maxDelayMs ?? 30_000;

  let attempt = 0;
  let delay = initial;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isNetworkError(err)) {
        throw err;
      }
      attempt += 1;
      console.warn(`[netRetry:${label}] attempt ${attempt} failed (${describeNetworkError(err)}); waiting ${delay / 1000}s before retry`);
      await sleep(delay);
      delay = Math.min(delay * 2, max);
    }
  }
}

function describeNetworkError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.code ?? err.message;
  }
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' ? code : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
