import { loadTestCaseGroup } from '../utils/testcaseLoader';

export const CASE_GROUPS = [
  loadTestCaseGroup('daily_forecast.yaml'),
  loadTestCaseGroup('weekly_forecast.yaml'),
  loadTestCaseGroup('temperature.yaml'),
  loadTestCaseGroup('hourly_forecast.yaml'),
  loadTestCaseGroup('air_quality.yaml'),
  loadTestCaseGroup('uat3_daily_forecast.yaml'),
  loadTestCaseGroup('uat3_weekly_forecast.yaml'),
  loadTestCaseGroup('uat3_temperature.yaml'),
  loadTestCaseGroup('uat3_hourly_forecast.yaml'),
  loadTestCaseGroup('uat3_air_quality.yaml'),
  loadTestCaseGroup('sample.yaml'),
];
