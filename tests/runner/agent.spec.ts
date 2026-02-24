import { createTestClient, buildRequestBody } from '../client/Client';
import { AgentResponse, ResultRow, TestCase } from '../types/type';
import { printSummaryTable } from '../utils/log';
import { appendRowsToSheet } from '../utils/googleSheet';
import { CASE_GROUPS } from '../data/testcase_groups';
import { sendSlackReport } from '../utils/slack';
import { ApiError } from '../errors';
import { env } from '../config/env';

const client = createTestClient();

describe('Agent API Regression', () => {
  const successes: ResultRow[] = [];
  const failures: ResultRow[] = [];

  const delay = env.SERVICE_DELAY_SEC;

  for (const group of CASE_GROUPS) {
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

            const result: ResultRow = {
              group: group.groupName,
              id: tc.id,
              request: data.requestMessage,
              response: data.response.message,
              mainIntent: data.response.mainIntent,
              subIntent: data.response.subIntent,
              time: duration,
              reason: errorMsg
            };

            if (errorMsg) failures.push(result);
            else successes.push(result);

          } catch (err) {
            const duration = Date.now() - start;
            failures.push(handleAxiosError(group.groupName, tc, err, body, duration));
            throw err;
          }
        });
      }
    });
  }

  afterAll(async () => {
    const reportTo = env.REPORT_TO;

    if (reportTo === 'sheet') {
      console.log('Reporting results to Google Sheets...');
      await appendRowsToSheet([...successes, ...failures]);
    } else {
      console.log('\nLocal Test Summary');
      if (successes.length > 0) printSummaryTable("SUCCESSES", successes);
      if (failures.length > 0) printSummaryTable("FAILURES", failures);
    }

    if (env.SLACK_WEBHOOK_URL) {
      console.log('Sending report to Slack...');
      await sendSlackReport(successes, failures);
    }
  }, env.TEST_TIMEOUT_SEC * 1000);
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
      reason: apiError.message,
      time
    };
  }
  return {
    group,
    id: tc.id,
    request: body.requestMessage,
    response: '[Unknown Error]',
    reason: String(err),
    time
  };
}
