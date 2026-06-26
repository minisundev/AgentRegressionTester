import { createTestClient, buildRequestBody, endAgentChat } from '../client/Client';
import { runAgentChatStream } from '../client/streamClient';
import { AgentResponse, RequestMode, ResultRow, TestCase } from '../types/type';
import { printSummaryTable } from '../utils/log';
import { appendRowToSheet, updateRowInSheet } from '../utils/googleSheet';
import { loadAllTestCases } from '../utils/testcaseLoader';
import { sendSlackReport } from '../utils/slack';
import { ApiError } from '../errors';
import { env } from '../config/env';
import { getCaseAccountId } from '../utils/accountId';
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

const client = createTestClient();
const reportTo = env.REPORT_TO;
const testTimeoutMs = env.TEST_TIMEOUT_SEC * 1000;

const REQUEST_MODES: RequestMode[] = [env.REQUEST_MODE];

jest.setTimeout(testTimeoutMs);

const runId = getRunId();
loadCheckpoint(runId);

describe('Agent API Regression', () => {
  const successes: ResultRow[] = [];
  const failures: ResultRow[] = [];

  for (const group of loadAllTestCases()) {
    describe(`${group.groupName} API`, () => {
      for (const tc of group.cases) {
        const allModesDone = REQUEST_MODES.every((mode) =>
          isCompleted(caseKey(String(group.groupName), tc.id, mode)));
        const test = allModesDone ? it.skip : it;

        test(`Q${tc.id} - [${group.groupName}] ${tc.name}`, async () => {
          const accountId = getCaseAccountId(group.groupName, tc);
          let anyError = false;

          for (const mode of REQUEST_MODES) {
            const key = caseKey(String(group.groupName), tc.id, mode);
            if (isCompleted(key)) {
              continue;
            }

            const { result, errored } = await executeMode(mode, String(group.groupName), tc, accountId);
            (errored ? failures : successes).push(result);

            if (reportTo === 'sheet') {
              const rowNumber = await persistRow(result, key);
              if (rowNumber !== undefined) {
                if (errored) {
                  markFailure(key, rowNumber);
                } else {
                  markSuccess(key);
                }
              }
            } else if (!errored) {
              markSuccess(key);
            }

            if (errored) {
              anyError = true;
            }
          }

          if (anyError) {
            throw new Error(`Q${tc.id} [${group.groupName}] failed (see ${reportTo === 'sheet' ? 'sheet' : 'summary'})`);
          }
        });
      }
    });
  }

  afterAll(async () => {
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

    const errorMsg = validateResponse(data);
    const result = buildResultRow(group, tc, data, duration, mode, errorMsg, ttft, tokenCount);
    return { result, errored: Boolean(errorMsg) };
  } catch (err) {
    const duration = Date.now() - start;
    return { result: handleAxiosError(group, tc, err, body, duration, mode), errored: true };
  } finally {
    if (!tc.isMultiTurn) {
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
    isMultiTurn: tc.isMultiTurn,
    mainIntent: data.response.mainIntent,
    subIntent: data.response.subIntent,
    time,
    reason: errorMsg,
    entity,
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

function validateResponse(data: AgentResponse): string | undefined {
  const errors: string[] = [];
  if (data.resultCode !== 200) errors.push(`Code:${data.resultCode}`);
  if (data.response.mainIntent !== 'Weather') errors.push(`Intent:${data.response.mainIntent}`);
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
