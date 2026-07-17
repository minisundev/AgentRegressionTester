import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { env } from './config/env';
import { PersonalCase, PersonalCaseGroup } from './types';

const TESTCASE_DIR = path.join(__dirname, 'config', 'testcases');

export function loadCaseGroups(): PersonalCaseGroup[] {
  const files = env.PERSONAL_CASE_GROUPS.split(',').map((f) => f.trim()).filter(Boolean);
  const groups: PersonalCaseGroup[] = [];

  for (const file of files) {
    const fullPath = path.join(TESTCASE_DIR, file);
    if (!fs.existsSync(fullPath)) {
      console.error(`[personal_e2e] testcase file not found: ${fullPath}`);
      process.exit(1);
    }
    const doc = yaml.load(fs.readFileSync(fullPath, 'utf8')) as {
      groupName?: string;
      cases?: PersonalCase[];
    };
    const cases = (doc.cases ?? []).filter(validateCase);
    groups.push({
      groupName: String(doc.groupName ?? path.basename(file, '.yaml')),
      cases: applyFilter(cases),
      sourceFile: file,
    });
  }
  return groups;
}

function applyFilter(cases: PersonalCase[]): PersonalCase[] {
  const filter = env.PERSONAL_CASE_FILTER;
  if (!filter) return cases;
  const needle = filter.toLowerCase();
  return cases.filter(
    (c) => String(c.id).toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle),
  );
}

function validateCase(c: PersonalCase): boolean {
  if (!c.turns?.length) {
    console.warn(`[personal_e2e] case ${c.id} (${c.name}) has no turns — skipped`);
    return false;
  }
  for (const turn of c.turns) {
    if (!turn.message || !turn.mainIntent || !turn.subIntent) {
      console.warn(`[personal_e2e] case ${c.id} has a turn missing message/mainIntent/subIntent — skipped`);
      return false;
    }
  }
  return true;
}
