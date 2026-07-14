import { createTestClient, buildRequestBody, endAgentChat } from '../client/Client';
import { runAgentChatStream } from '../client/streamClient';
import { AgentResponse, RequestMode, ResultRow, TestCase } from '../types/type';
import { printSummaryTable } from '../utils/log';
import { appendRowToSheet, updateRowInSheet } from '../utils/googleSheet';
import { loadAllTestCases } from '../utils/testcaseLoader';
import { sendSlackReport } from '../utils/slack';
import { ApiError } from '../errors';
import { env } from '../config/env';
import { getPooledAccountId } from '../utils/accountId';
import {
  caseKey,
  getFailureRow,
  getRunId,
  isCompleted,
  loadCheckpoint,
  markFailure,
  markSuccess,
} from '../utils/checkpoint';
import { withNetworkRetry } from '../utils/networkRetry';
import { closeAgentResponsePublisher, publishAgentResponse } from '../utils/agentResponsePublisher';
import {
  evaluateEntityGolden,
  formatEntityGoldenDifferences,
  type EntityGoldenResult,
} from '../utils/entityGolden';

const client = createTestClient();
const reportTo = env.REPORT_TO;
const testTimeoutMs = env.TEST_TIMEOUT_SEC * 1000;

const REQUEST_MODES: RequestMode[] = [env.REQUEST_MODE];

jest.setTimeout(testTimeoutMs);

const runId = getRunId();
loadCheckpoint(runId);

interface ExecutionUnit {
  groupName: string;
  // Several yaml files reuse the same groupName (e.g. "Weather"), so checkpoint
  // keys must be namespaced by source file or their cases collide and overwrite
  // each other's completion state and sheet rows.
  checkpointGroup: string;
  cases: TestCase[];
  isMultiTurn: boolean;
}

function isMultiTurnCase(tc: TestCase): boolean {
  return tc.isMultiTurn === true || tc.multiTurn === true;
}

function multiTurnKey(checkpointGroup: string, tc: TestCase): string {
  const parentId = String(tc.id).replace(/-\d+$/, '');
  return `${checkpointGroup}:${parentId}`;
}

function buildExecutionUnits(): ExecutionUnit[] {
  const units: ExecutionUnit[] = [];
  const multiTurnUnits = new Map<string, ExecutionUnit>();

  for (const group of loadAllTestCases()) {
    const groupName = String(group.groupName);
    const checkpointGroup = `${group.sourceFile}::${groupName}`;
    for (const tc of group.cases) {
      if (!isMultiTurnCase(tc)) {
        units.push({ groupName, checkpointGroup, cases: [tc], isMultiTurn: false });
        continue;
      }

      const key = multiTurnKey(checkpointGroup, tc);
      let unit = multiTurnUnits.get(key);
      if (!unit) {
        unit = { groupName, checkpointGroup, cases: [], isMultiTurn: true };
        multiTurnUnits.set(key, unit);
        units.push(unit);
      }
      unit.cases.push(tc);
    }
  }

  return units;
}

describe('Agent API Regression', () => {
  const successes: ResultRow[] = [];
  const failures: ResultRow[] = [];

  const units = buildExecutionUnits();
  const laneCount = Math.max(1, Math.min(env.PARALLEL_ACCOUNT_COUNT, units.length || 1));
  const laneTails = Array.from({ length: laneCount }, () => Promise.resolve());
  console.log(`[runner] executing with ${laneCount} isolated account lane(s)`);

  for (const [unitIndex, unit] of units.entries()) {
    const laneIndex = unitIndex % laneCount;
    const ids = unit.cases.map((tc) => `Q${tc.id}`).join(', ');
    const allModesDone = unit.cases.every((tc) => REQUEST_MODES.every((mode) =>
      isCompleted(caseKey(unit.checkpointGroup, tc.id, mode))));
    const test = allModesDone ? it.skip : it.concurrent;

    test(`${ids} - [${unit.groupName}] ${unit.cases[0]?.name ?? ''}`, async () => {
      // Calls assigned to one account lane form a promise chain. Other lanes
      // keep running, while this account is never touched by two units at once.
      const previous = laneTails[laneIndex]!;
      let releaseLane!: () => void;
      laneTails[laneIndex] = new Promise<void>((resolve) => { releaseLane = resolve; });
      await previous;

      const accountId = getPooledAccountId(laneIndex);
      const failedCases: string[] = [];

      try {
        for (const [caseIndex, tc] of unit.cases.entries()) {
          let anyError = false;

          for (const [modeIndex, mode] of REQUEST_MODES.entries()) {
            const key = caseKey(unit.checkpointGroup, tc.id, mode);
            const alreadyCompleted = isCompleted(key);
            // A resumed multi-turn unit must replay its earlier turns to rebuild
            // server context, but those checkpointed rows are not written twice.
            if (alreadyCompleted && !unit.isMultiTurn) continue;

            const isLastMultiTurnRequest = unit.isMultiTurn
              && caseIndex === unit.cases.length - 1
              && modeIndex === REQUEST_MODES.length - 1;
            const { result, errored } = await executeMode(
              mode,
              unit.groupName,
              tc,
              accountId,
              isLastMultiTurnRequest,
            );
            (errored ? failures : successes).push(result);

            if (!alreadyCompleted && reportTo === 'sheet') {
              const rowNumber = await persistRow(result, key);
              if (rowNumber !== undefined) {
                if (errored) markFailure(key, rowNumber);
                else markSuccess(key);
              }
            } else if (!alreadyCompleted && !errored) {
              markSuccess(key);
            }

            anyError ||= errored;
          }

          if (anyError) failedCases.push(`Q${tc.id} [${unit.groupName}]`);
        }

        if (failedCases.length > 0) {
          throw new Error(`${failedCases.join(', ')} failed (see ${reportTo === 'sheet' ? 'sheet' : 'summary'})`);
        }
      } finally {
        releaseLane();
      }
    }, testTimeoutMs);
  }

  afterAll(async () => {
    closeAgentResponsePublisher();
    if (reportTo === 'terminal') {
      console.log('\nLocal Test Summary');
      if (successes.length > 0) printSummaryTable("SUCCESSES", successes);
      if (failures.length > 0) printSummaryTable("FAILURES", failures);
    }

    if (env.SLACK_WEBHOOK_URL) {
      console.log('Sending report to Slack...');
      await sendSlackReport(successes, failures);
    }
  }, testTimeoutMs);
});

async function executeMode(
  mode: RequestMode,
  group: string,
  tc: TestCase,
  accountId: string | undefined,
  endMultiTurnUnit = false,
): Promise<{ result: ResultRow; errored: boolean }> {
  const body = buildRequestBody(tc.message, tc.agentType, tc.mainIntent, tc.subIntent, accountId);
  const start = Date.now();

  try {
    let data: AgentResponse;
    let duration: number;
    let ttft: number | undefined;
    let tokenCount: number | undefined;

    if (mode === 'stream') {
      const streamed = await withNetworkRetry(
        () => runAgentChatStream(body),
        { label: `agentChatStream:Q${tc.id}` },
      );
      data = streamed.data;
      duration = streamed.metrics.totalTime;
      ttft = streamed.metrics.ttft;
      tokenCount = streamed.metrics.tokenCount;
    } else {
      const res = await withNetworkRetry(
        () => client.post<AgentResponse>('', body),
        { label: `agentChat:Q${tc.id}` },
      );
      data = res.data;
      duration = Date.now() - start;
    }

    const entityGolden: EntityGoldenResult = data.resultCode !== 200 && !data.response.entity
      ? { status: 'NA', expected: tc.expectedEntity, differences: [] }
      : evaluateEntityGolden(tc, data.response.entity);
    await publishAgentResponse(body.transactionId, accountId, group, tc, mode, data, entityGolden);

    const errorMsg = validateResponse(data, entityGolden);
    const result = buildResultRow(
      group,
      tc,
      data,
      duration,
      mode,
      errorMsg,
      entityGolden,
      ttft,
      tokenCount,
    );
    return { result, errored: Boolean(errorMsg) };
  } catch (err) {
    const duration = Date.now() - start;
    return { result: handleAxiosError(group, tc, err, body, duration, mode), errored: true };
  } finally {
    if (!isMultiTurnCase(tc) || endMultiTurnUnit) {
      await endAgentChat(client, body);
    }
  }
}

function buildResultRow(
  group: string,
  tc: TestCase,
  data: AgentResponse,
  time: number,
  mode: RequestMode,
  errorMsg: string | undefined,
  entityGolden: EntityGoldenResult,
  ttft?: number,
  tokenCount?: number,
): ResultRow {
  const entity = data.response.entity ? JSON.stringify(data.response.entity) : '';
  const todayCard = data.response.todayCard ? JSON.stringify(data.response.todayCard) : '';
  const card = data.response.weeklyCard
    ? JSON.stringify(data.response.weeklyCard)
    : data.response.hourlyCard
    ? JSON.stringify(data.response.hourlyCard)
    : '';

  return {
    group,
    id: tc.id,
    request: data.requestMessage,
    response: data.response.message,
    reqTranslation: tc.reqTranslation,
    isMultiTurn: isMultiTurnCase(tc),
    mainIntent: data.response.mainIntent,
    subIntent: data.response.subIntent,
    time,
    reason: errorMsg,
    entity,
    expectedEntity: entityGolden.expected === undefined ? '' : JSON.stringify(entityGolden.expected),
    entityGoldenStatus: entityGolden.status,
    entityGoldenDiff: formatEntityGoldenDifferences(entityGolden),
    todayCard,
    card,
    mode,
    ttft,
    tokenCount,
  };
}

async function persistRow(result: ResultRow, key: string): Promise<number | undefined> {
  const existingRow = getFailureRow(key);
  if (existingRow !== undefined) {
    const ok = await updateRowInSheet(result, existingRow);
    return ok ? existingRow : undefined;
  }
  return appendRowToSheet(result);
}

function validateResponse(data: AgentResponse, entityGolden: EntityGoldenResult): string | undefined {
  const errors: string[] = [];
  if (data.resultCode !== 200) errors.push(`Code:${data.resultCode}`);
  if (data.response.mainIntent !== 'Weather') errors.push(`Intent:${data.response.mainIntent}`);
  if (entityGolden.status === 'FAIL') {
    errors.push(`EntityGolden:${formatEntityGoldenDifferences(entityGolden)}`);
  }
  return errors.length > 0 ? errors.join('; ') : undefined;
}

function handleAxiosError(
  group: string,
  tc: TestCase,
  err: unknown,
  body: any,
  time: number,
  mode: RequestMode,
): ResultRow {
  if (ApiError.isAxiosError(err)) {
    const apiError = ApiError.fromAxiosError(err);
    return {
      group,
      id: tc.id,
      request: body.requestMessage,
      response: `[HTTP ${apiError.statusCode}]`,
      reqTranslation: tc.reqTranslation,
      isMultiTurn: tc.isMultiTurn,
      mainIntent: tc.mainIntent,
      subIntent: tc.subIntent,
      reason: apiError.message,
      time,
      mode,
    };
  }
  return {
    group,
    id: tc.id,
    request: body.requestMessage,
    response: '[Unknown Error]',
    reqTranslation: tc.reqTranslation,
    isMultiTurn: tc.isMultiTurn,
    mainIntent: tc.mainIntent,
    subIntent: tc.subIntent,
    reason: String(err),
    time,
    mode,
  };
}
