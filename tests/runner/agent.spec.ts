import axios from 'axios';
import { createTestClient, buildRequestBody } from '../client/Client';
import { AgentResponse, ResultRow, TestCase } from '../types/type';
import { printSummaryTable } from '../utils/log';
import { appendRowsToSheet } from '../utils/googleSheet';
import { CASE_GROUPS } from '../data/testcase_groups';

const client = createTestClient();

describe('Agent API Regression', () => {
  const successes: ResultRow[] = [];
  const failures: ResultRow[] = [];

  for (const group of CASE_GROUPS) {
    describe(`${group.groupName} API`, () => {
      for (const tc of group.cases) {
        it(`Q${tc.id} - [${group.groupName}] ${tc.name}`, async () => {
          const body = buildRequestBody(tc.message, process.env.MAIN_INTENT, tc.subIntent, );
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
              tts: data.response.ttsText,
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
    const reportTo = process.env.REPORT_TO || 'terminal';

    if (reportTo === 'sheet') {
      console.log('Reporting results to Google Sheets...');
      await appendRowsToSheet([...successes, ...failures]);
    } else {
      console.log('\nLocal Test Summary');
      if (successes.length > 0) printSummaryTable("SUCCESSES", successes);
      if (failures.length > 0) printSummaryTable("FAILURES", failures);
    }
  });
});

function validateResponse(data: AgentResponse): string | undefined {
  const errors: string[] = [];
  if (data.resultCode !== 200) errors.push(`Code:${data.resultCode}`);
  if (data.response.mainIntent !== 'Weather') errors.push(`Intent:${data.response.mainIntent}`);
  return errors.length > 0 ? errors.join('; ') : undefined;
}

function handleAxiosError(group: string, tc: TestCase, err: any, body: any, time: number): ResultRow {
  const isAxios = axios.isAxiosError(err);
  return {
    group,
    id: tc.id,
    request: body.requestMessage,
    response: isAxios ? `[HTTP ${err.response?.status}]` : '[Unknown Error]',
    reason: isAxios ? JSON.stringify(err.response?.data) : String(err),
    time
  };
}