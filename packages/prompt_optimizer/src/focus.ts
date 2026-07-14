import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadAllTestCases } from '../../e2e_regression/utils/testcaseLoader';
import type { ResultRow, TestCase } from '../../e2e_regression/types/type';

export const FOCUS_FILE = 'optimizer_focus.yaml';
export const FOCUS_GROUP = 'OptimizerFocus';

const TESTCASE_DIR = path.resolve(__dirname, '../../e2e_regression/config/testcases');

function isMultiTurn(tc: TestCase): boolean {
  return tc.isMultiTurn === true || tc.multiTurn === true;
}

// 실패한 케이스만 원본 yaml들에서 추출해 단독 실행 가능한 focus 파일을 만든다.
// id는 그룹명을 접두어로 붙여 파일 간 충돌을 막는다 (멀티턴 -N 접미어는 유지).
export function buildFocusFile(failures: ResultRow[]): { caseCount: number; skipped: string[] } {
  const groups = loadAllTestCases();
  const cases: TestCase[] = [];
  const seen = new Set<string>();
  const skipped: string[] = [];

  for (const f of failures) {
    const group = groups.find(
      (g) => g.groupName === f.group && g.cases.some((c) => String(c.id) === String(f.id))
    );
    if (!group) {
      skipped.push(`${f.group}::Q${f.id}`);
      continue;
    }

    const base = group.cases.find((c) => String(c.id) === String(f.id))!;
    // 멀티턴 케이스는 앞 턴들이 서버 컨텍스트를 만들므로 형제 턴 전부 포함
    const parentId = String(base.id).replace(/-\d+$/, '');
    const targets = isMultiTurn(base)
      ? group.cases.filter((c) => String(c.id).replace(/-\d+$/, '') === parentId)
      : [base];

    for (const tc of targets) {
      const focusId = `${group.groupName}__${tc.id}`;
      if (seen.has(focusId)) continue;
      seen.add(focusId);
      cases.push({ ...tc, id: focusId });
    }
  }

  const focusPath = path.join(TESTCASE_DIR, FOCUS_FILE);
  fs.writeFileSync(focusPath, yaml.dump({ groupName: FOCUS_GROUP, cases }), 'utf8');
  return { caseCount: cases.length, skipped };
}
