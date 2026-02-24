import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { TestCase } from '../types/type';
import { ConfigurationError } from '../errors';

const TESTCASE_DIR = path.resolve(__dirname, '../config/testcases');

interface TestCaseGroup {
  groupName: string;
  cases: TestCase[];
}

interface YamlTestCaseFile {
  groupName: string;
  cases: TestCase[];
}

export function loadTestCaseGroup(fileName: string): TestCaseGroup {
  try {
    const filePath = path.join(TESTCASE_DIR, fileName);
    const fileContents = fs.readFileSync(filePath, 'utf8');
    const data = yaml.load(fileContents) as YamlTestCaseFile;

    return {
      groupName: data.groupName,
      cases: data.cases,
    };
  } catch (error) {
    const configError = new ConfigurationError(
      `Failed to load test case file: ${fileName}`,
      path.join(TESTCASE_DIR, fileName)
    );
    console.error(`[${configError.code}] ${configError.message}`, configError.context);
    throw configError;
  }
}

export function loadAllTestCases(): TestCaseGroup[] {
  const testCaseFiles = [
    'daily_forecast.yaml',
    'weekly_forecast.yaml',
    'temperature.yaml',
    'hourly_forecast.yaml',
    'air_quality.yaml',
    'uat3_daily_forecast.yaml',
    'uat3_weekly_forecast.yaml',
    'uat3_temperature.yaml',
    'uat3_hourly_forecast.yaml',
    'uat3_air_quality.yaml',
    'sample.yaml',
  ];

  const groups: TestCaseGroup[] = [];

  for (const fileName of testCaseFiles) {
    try {
      const group = loadTestCaseGroup(fileName);
      groups.push(group);
    } catch (error) {
      console.warn(`Skipping ${fileName} due to load error`);
    }
  }

  return groups;
}

export function loadSelectedTestCases(fileNames: string[]): TestCaseGroup[] {
  return fileNames.map((fileName) => loadTestCaseGroup(fileName));
}
