import { TestCase } from "../types/type";
import { DAILY_FORECAST_TEST_CASES, WEEKLY_FORECAST_TEST_CASES, TEMPERATURE_TEST_CASES, HOURLY_FORECAST_TEST_CASES, AIR_QUALITY_TEST_CASES, SAMPLE_TEST_CASES } from "./weather";
import { UAT3_DAILY_FORECAST_TEST_CASES, UAT3_HOURLY_FORECAST_TEST_CASES, UAT3_TEMPERATURE_TEST_CASES, UAT3_AIR_QUALITY_TEST_CASES, UAT3_WEEKLY_FORECAST_TEST_CASES } from "./weather";

export const CASE_GROUPS: {
  groupName: string;
  cases: TestCase[];
}[] = [
//   { groupName: 'Weather', cases: DAILY_FORECAST_TEST_CASES },
//   { groupName: 'Weather', cases: WEEKLY_FORECAST_TEST_CASES },
//   { groupName: 'Weather', cases: TEMPERATURE_TEST_CASES },
//   { groupName: 'Weather', cases: HOURLY_FORECAST_TEST_CASES },
//   { groupName: 'Weather', cases: AIR_QUALITY_TEST_CASES },
//   { groupName: 'Weather', cases: UAT3_DAILY_FORECAST_TEST_CASES },
//   { groupName: 'Weather', cases: UAT3_WEEKLY_FORECAST_TEST_CASES },
   { groupName: 'Weather', cases: UAT3_TEMPERATURE_TEST_CASES },
//   { groupName: 'Weather', cases: UAT3_HOURLY_FORECAST_TEST_CASES },
//   { groupName: 'Weather', cases: UAT3_AIR_QUALITY_TEST_CASES },
//   { groupName: 'Sample', cases: SAMPLE_TEST_CASES }
];
