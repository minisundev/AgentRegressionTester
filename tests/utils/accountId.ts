import { env } from '../config/env';
import { TestCase } from '../types/type';

const runId = Date.now().toString(36);

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

    return `${base}-${runId}-${sanitize(groupName)}-${sanitize(String(tc.id))}`;
}
