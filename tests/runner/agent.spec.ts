import { createTestClient, buildRequestBody } from '../client/Client';
import { AgentResponse, ResultRow, TestCase } from '../types/type';
import { printSummaryTable } from '../utils/log';
import { appendRowToSheet } from '../utils/googleSheet';
import { loadAllTestCases } from '../utils/testcaseLoader';
import { sendSlackReport } from '../utils/slack';
import { ApiError } from '../errors';
import { env } from '../config/env';

const client = createTestClient();
const reportTo = env.REPORT_TO;
const testTimeoutMs = env.TEST_TIMEOUT_SEC * 1000;

jest.setTimeout(testTimeoutMs);

describe('Agent API Regression', () => {
  const successes: ResultRow[] = [];
  const failures: ResultRow[] = [];

  const delay = env.SERVICE_DELAY_SEC;

  for (const group of loadAllTestCases()) {
    describe(`${group.groupName} API`, () => {
      for (const tc of group.cases) {
        it(`Q${tc.id} - [${group.groupName}] ${tc.name}`, async () => {
          //서버 과부하 방지
          if (delay > 0) {
            await sleep(delay);
          }

          const body = buildRequestBody(tc.message, tc.agentType, tc.mainIntent, tc.subIntent);
          const start = Date.now();

          try {
            const { data } = await client.post<AgentResponse>('', body);
            const duration = Date.now() - start;

            const errorMsg = validateResponse(data);

            const entity = data.response.entity ? JSON.stringify(data.response.entity) : '';
            const todayCard = data.response.todayCard ? JSON.stringify(data.response.todayCard) : '';
            const card = data.response.weeklyCard
              ? JSON.stringify(data.response.weeklyCard)
              : data.response.hourlyCard
              ? JSON.stringify(data.response.hourlyCard)
              : '';

            const result: ResultRow = {
              group: String(group.groupName),
              id: tc.id,
              request: data.requestMessage,
              response: data.response.message,
              mainIntent: data.response.mainIntent,
              subIntent: data.response.subIntent,
              time: duration,
              reason: errorMsg,
              entity,
              todayCard,
              card,
            };

            if (errorMsg) {
              failures.push(result);
            } else {
              successes.push(result);
            }

            if (reportTo === 'sheet') {
              await appendRowToSheet(result);
            }

          } catch (err) {
            const duration = Date.now() - start;
            const errResult = handleAxiosError(group.groupName, tc, err, body, duration);
            failures.push(errResult);

            if (reportTo === 'sheet') {
              await appendRowToSheet(errResult);
            }

            throw err;
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

const sleep = (sec: number) => new Promise(resolve => setTimeout(resolve, sec * 1000));

function validateResponse(data: AgentResponse): string | undefined {
  const errors: string[] = [];
  if (data.resultCode !== 200) errors.push(`Code:${data.resultCode}`);
  if (data.response.mainIntent !== 'Weather') errors.push(`Intent:${data.response.mainIntent}`);
  return errors.length > 0 ? errors.join('; ') : undefined;
}

function handleAxiosError(group: string, tc: TestCase, err: unknown, body: any, time: number): ResultRow {
  if (ApiError.isAxiosError(err)) {
    const apiError = ApiError.fromAxiosError(err);
    return {
      group,
      id: tc.id,
      request: body.requestMessage,
      response: `[HTTP ${apiError.statusCode}]`,
      mainIntent: tc.mainIntent,
      subIntent: tc.subIntent,
      reason: apiError.message,
      time
    };
  }
  return {
    group,
    id: tc.id,
    request: body.requestMessage,
    response: '[Unknown Error]',
    mainIntent: tc.mainIntent,
    subIntent: tc.subIntent,
    reason: String(err),
    time
  };
}
