import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { TestCase } from '../types/type';
import { ConfigurationError } from '../errors';
import { CASE_GROUPS } from '../data/testcase_groups';

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
  const testCaseFiles = CASE_GROUPS;

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
