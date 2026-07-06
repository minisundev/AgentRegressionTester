import type { TestCase } from '../types/type';

export interface EntityGoldenDifference {
  path: string;
  expected: unknown;
  actual: unknown;
  problem: string;
}

export interface EntityGoldenResult {
  status: 'PASS' | 'FAIL' | 'NA';
  expected?: Record<string, unknown> | null;
  differences: EntityGoldenDifference[];
}

const MISSING = Symbol('missing');

/**
 * Inline testcase goldens default to subset matching: every declared semantic
 * field is strict, while unrelated parser fields are ignored.
 */
export function evaluateEntityGolden(
  tc: TestCase,
  actualEntity: Record<string, unknown> | undefined,
): EntityGoldenResult {
  const expected = tc.expectedEntity;
  if (expected === undefined) return { status: 'NA', differences: [] };

  if (expected === null) {
    return actualEntity === undefined
      ? { status: 'PASS', expected: null, differences: [] }
      : {
          status: 'FAIL',
          expected: null,
          differences: [{ path: 'entity', expected: null, actual: actualEntity, problem: 'expected entity to be absent' }],
        };
  }

  const differences: EntityGoldenDifference[] = [];
  compareValue(expected, actualEntity ?? MISSING, 'entity', differences, tc.entityMatchMode ?? 'subset');
  return {
    status: differences.length === 0 ? 'PASS' : 'FAIL',
    expected,
    differences,
  };
}

function compareValue(
  expected: unknown,
  actual: unknown | typeof MISSING,
  path: string,
  differences: EntityGoldenDifference[],
  matchMode: 'exact' | 'subset',
): void {
  if (actual === MISSING) {
    differences.push({ path, expected, actual: undefined, problem: 'missing field' });
    return;
  }

  if (isMatcher(expected)) {
    compareMatcher(expected, actual, path, differences);
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      differences.push({ path, expected, actual, problem: 'expected array' });
      return;
    }
    if (expected.length !== actual.length) {
      differences.push({ path, expected: expected.length, actual: actual.length, problem: 'array length mismatch' });
    }
    expected.forEach((item, index) => compareValue(item, index < actual.length ? actual[index] : MISSING, `${path}[${index}]`, differences, matchMode));
    return;
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      differences.push({ path, expected, actual, problem: 'expected object' });
      return;
    }
    for (const [key, value] of Object.entries(expected)) {
      compareValue(value, Object.prototype.hasOwnProperty.call(actual, key) ? actual[key] : MISSING, `${path}.${key}`, differences, matchMode);
    }
    if (matchMode === 'exact') {
      for (const key of Object.keys(actual)) {
        if (!Object.prototype.hasOwnProperty.call(expected, key)) {
          differences.push({ path: `${path}.${key}`, expected: undefined, actual: actual[key], problem: 'unexpected field' });
        }
      }
    }
    return;
  }

  if (!Object.is(expected, actual)) {
    differences.push({ path, expected, actual, problem: 'value mismatch' });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMatcher(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && ('$any' in value || '$regex' in value || '$oneOf' in value);
}

function compareMatcher(
  matcher: Record<string, unknown>,
  actual: unknown,
  path: string,
  differences: EntityGoldenDifference[],
): void {
  if (matcher.$any === true) return;

  if (typeof matcher.$regex === 'string') {
    try {
      if (typeof actual === 'string' && new RegExp(matcher.$regex).test(actual)) return;
    } catch {
      differences.push({ path, expected: matcher, actual, problem: 'invalid regex matcher' });
      return;
    }
    differences.push({ path, expected: matcher, actual, problem: 'regex mismatch' });
    return;
  }

  if (Array.isArray(matcher.$oneOf)) {
    if (matcher.$oneOf.some((candidate) => Object.is(candidate, actual))) return;
    differences.push({ path, expected: matcher, actual, problem: 'not one of allowed values' });
  }
}

export function formatEntityGoldenDifferences(result: EntityGoldenResult): string {
  return result.differences
    .map((difference) => `${difference.path}: expected=${formatValue(difference.expected)}, actual=${formatValue(difference.actual)} (${difference.problem})`)
    .join('\n');
}

function formatValue(value: unknown): string {
  return value === undefined ? '<missing>' : JSON.stringify(value);
}
