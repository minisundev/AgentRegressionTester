import { env } from '../config/env';
import { TestCase } from '../types/type';

const runId = Date.now().toString(36);

// Jest assigns each worker a 1-based JEST_WORKER_ID (set to '1' when run in-band).
// Suffixing accountId with it keeps one account per parallel worker, so the
// number of accounts auto-scales with maxWorkers and workers never collide.
const workerId = process.env.JEST_WORKER_ID || '1';

function sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function getBaseAccountId(): string {
    return sanitize(env.ACCOUNT_ID?.trim() || 'agent-regression');
}

function getMultiTurnGroupKey(groupName: string, tc: TestCase): string {
    const id = String(tc.id);
    const parentId = id.replace(/-\d+$/, '');
    return sanitize(`${groupName}-${parentId}`);
}

export function getCaseAccountId(groupName: string, tc: TestCase): string {
    const base = getBaseAccountId();

    if (tc.isMultiTurn) {
        return `${base}-mt-${getMultiTurnGroupKey(groupName, tc)}`;
    }

    // Single-turn cases share one accountId per run+worker; chatEnd resets
    // context between cases so logs stay grouped under a few traceable accounts.
    return `${base}-${runId}-w${workerId}`;
}

/**
 * Returns one of the bounded account IDs used by the parallel test lanes.
 * A lane owns its account for the whole run, so a multi-turn unit cannot have
 * its context reset by another concurrently executing case.
 */
export function getPooledAccountId(slot: number): string {
    const normalizedSlot = Math.max(0, Math.trunc(slot));
    return `${getBaseAccountId()}-${runId}-a${normalizedSlot + 1}`;
}
