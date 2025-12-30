import axios, { type AxiosInstance } from 'axios';
import {
  DAILY_FORECAST_TEST_CASES,
  HOURLY_FORECAST_TEST_CASES,
  TEMPERATURE_TEST_CASES,
  AIR_QUALITY_TEST_CASES,
  WEEKLY_FORECAST_TEST_CASES
} from '../testcase';
import {
  createWeatherTestClient,
  buildWeatherRequestBody
} from '../../client/weatherClient';
import { AgentResponse, WeatherResultRow, WeatherTestCase } from '../../types/weather';
import Table from 'cli-table3';
import { TC1, UAT3_1, UAT3_1_50, UAT3_2, UAT3_3, UAT3_4, UAT3_5, UAT3_51_100, UAT3_6 } from '../../data/uat_testcase';

const client = createWeatherTestClient();

const CASE_GROUPS: {
  groupName: string;
  cases: WeatherTestCase[];
}[] = [
  { groupName: 'DailyForecast', cases: DAILY_FORECAST_TEST_CASES },
  { groupName: 'HourlyForecast', cases: HOURLY_FORECAST_TEST_CASES },
  { groupName: 'Temperature', cases: TEMPERATURE_TEST_CASES },
  { groupName: 'AirQuality', cases: AIR_QUALITY_TEST_CASES },
  { groupName: 'WeeklyForecast', cases: WEEKLY_FORECAST_TEST_CASES },
  //{ groupName: 'UAT_TestCases', cases: TC1 },
  //{ groupName: 'UAT3_1_50', cases: UAT3_1_50 },
  //{ groupName: 'UAT3_51_100', cases: UAT3_51_100 },
  //{ groupName: 'UAT3_1', cases: UAT3_1 },
  //{ groupName: 'UAT3_2', cases: UAT3_2 },
  //{ groupName: 'UAT3_3', cases: UAT3_3 },
  //{ groupName: 'UAT3_4', cases: UAT3_4 },
  //{ groupName: 'UAT3_5', cases: UAT3_5 },
  //{ groupName: 'UAT3_6', cases: UAT3_6 },
];

describe('Weather API Regression', () => {
  const successes: WeatherResultRow[] = [];
  const failures: WeatherResultRow[] = [];

  for (const group of CASE_GROUPS) {
    describe(`${group.groupName} API`, () => {
      for (const tc of group.cases) {
        it(`Q${tc.id} - [${group.groupName}] ${tc.name}`, async () => {
          await run(group.groupName, tc, client, successes, failures);
        });
      }
    });
  }

  afterAll(() => {
    printSummaryTable("successes",successes);
    printSummaryTable("failures",failures);
  });
});

async function run(
  groupName: string,
  tc: WeatherTestCase,
  client: AxiosInstance,
  successes: WeatherResultRow[],
  failures: WeatherResultRow[]
) {
  const body = buildWeatherRequestBody(tc.message, tc.subIntent);
  const start = Date.now();

  try {
    const { data } = await client.post<AgentResponse>('', body);
    const end = Date.now() - start;
    handleSuccess(groupName, tc, data, successes, end);
  } catch (err) {
    const end = Date.now() - start;
    handleError(groupName, err, tc, body, failures, end);
    throw err;
  }
}

function handleSuccess(
  groupName: string,
  tc: WeatherTestCase,
  data: AgentResponse,
  successes: WeatherResultRow[],
  time: number
) {
  const errors: string[] = [];

  if (data.resultCode !== 200) {
    errors.push(`resultCode mismatch: ${data.resultCode}`);
  }

  if (data.response.mainIntent !== 'Weather') {
    errors.push(
      `mainIntent mismatch: ${data.response.mainIntent}`,
    );
  }

  if (errors.length > 0) {
    successes.push({
      group: groupName,
      id: tc.id,
      request: data.requestMessage,
      response: data.response.message,
      mainIntent: data.response.mainIntent,
      subIntent: data.response.subIntent,
      reason: errors.join('; '),
      time: time,
    });
    return;
  }

  successes.push({
    group: groupName,
    id: tc.id,
    request: data.requestMessage,
    response: data.response.message,
    mainIntent: data.response.mainIntent,
    subIntent: data.response.subIntent,
    tts: data.response.ttsText,
    time: time,
  });
}


function handleError(
  groupName: string,
  err: unknown,
  tc: WeatherTestCase,
  body: ReturnType<typeof buildWeatherRequestBody>,
  failures: WeatherResultRow[],
  time: number
) {
  if (axios.isAxiosError(err) && err.response) {
    failures.push({
      group: groupName,
      id: tc.id,
      request: body.requestMessage,
      response: `[ERROR ${err.response.status}]`,
      reason: `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`,
      time: time
    });
  } else {
    failures.push({
      group: groupName,
      id: tc.id,
      request: body.requestMessage,
      response: `[UNKNOWN ERROR]`,
      reason: String(err),
      time: time
    });
  }
}

function printSummaryTable(title: string, rows: WeatherResultRow[]) {
  console.log(`${title} (${rows.length})`);
  const table = new Table({
    wordWrap: true,
    colWidths: [10, 40, 20, 20, 80, 15],
  });

  table.push(
    ...rows.map(r => [
      r.id,
      r.request,
      r.mainIntent,
      r.subIntent,
      r.response,
      r.time+'ms',
    ])
  );

  console.log(table.toString());
}
