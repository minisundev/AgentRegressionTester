import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

const CHECKPOINT_PATH = path.resolve(process.cwd(), '.checkpoint.json');

interface CheckpointFile {
  runId: string;
  successKeys: string[];
  failureRows: Record<string, number>;
}

let state: CheckpointFile | null = null;

export function getRunId(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${env.GOOGLE_SHEET_NAME}-${yyyy}-${mm}-${dd}`;
}

export function caseKey(groupName: string, id: string | number, mode?: string): string {
  const base = `${groupName}::${id}`;
  return mode ? `${base}::${mode}` : base;
}

export function loadCheckpoint(runId: string): void {
  if (!fs.existsSync(CHECKPOINT_PATH)) {
    state = freshState(runId);
    return;
  }

  try {
    const raw = fs.readFileSync(CHECKPOINT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CheckpointFile>;

    if (parsed.runId !== runId) {
      console.log(`[checkpoint] runId changed (${parsed.runId} -> ${runId}); starting fresh`);
      state = freshState(runId);
      persist();
      return;
    }

    state = {
      runId,
      successKeys: Array.isArray(parsed.successKeys) ? parsed.successKeys : [],
      failureRows: parsed.failureRows && typeof parsed.failureRows === 'object'
        ? parsed.failureRows
        : {},
    };

    const skipCount = state.successKeys.length;
    const retryCount = Object.keys(state.failureRows).length;
    console.log(`[checkpoint] resuming runId=${runId} (skip=${skipCount}, retry=${retryCount})`);
  } catch (err) {
    console.warn(`[checkpoint] failed to read ${CHECKPOINT_PATH}; starting fresh: ${String(err)}`);
    state = freshState(runId);
  }
}

export function isCompleted(key: string): boolean {
  return state?.successKeys.includes(key) ?? false;
}

export function getFailureRow(key: string): number | undefined {
  return state?.failureRows[key];
}

export function markSuccess(key: string): void {
  if (!state) return;
  if (!state.successKeys.includes(key)) {
    state.successKeys.push(key);
  }
  delete state.failureRows[key];
  persist();
}

export function markFailure(key: string, rowNumber: number): void {
  if (!state) return;
  state.failureRows[key] = rowNumber;
  persist();
}

function freshState(runId: string): CheckpointFile {
  return { runId, successKeys: [], failureRows: {} };
}

function persist(): void {
  if (!state) return;
  try {
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[checkpoint] failed to write ${CHECKPOINT_PATH}: ${String(err)}`);
  }
}
