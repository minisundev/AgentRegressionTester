import { evaluateEntityGolden } from '../utils/entityGolden';
import type { TestCase } from '../types/type';

function testcase(expectedEntity: Record<string, unknown>, entityMatchMode?: 'exact' | 'subset'): TestCase {
  return {
    id: 1,
    name: 'golden',
    message: 'weather',
    mainIntent: 'Weather',
    subIntent: 'CheckHourlyForecast',
    agentType: 'DailyInfoAgent',
    expectedEntity,
    entityMatchMode,
  };
}

describe('entity golden matcher', () => {
  it('passes declared fields and ignores extra actual fields', () => {
    const result = evaluateEntityGolden(testcase({ location: 'Hanoi', delta: null }), {
      location: 'Hanoi',
      delta: null,
      relativeHours: 0,
    });
    expect(result.status).toBe('PASS');
  });

  it('fails unexpected fields in explicit exact mode', () => {
    const result = evaluateEntityGolden(testcase({ location: 'Hanoi' }, 'exact'), {
      location: 'Hanoi',
      delta: null,
    });
    expect(result.status).toBe('FAIL');
    expect(result.differences[0]?.problem).toBe('unexpected field');
  });

  it('reports a field-level mismatch', () => {
    const result = evaluateEntityGolden(testcase({ specificHour: 9 }), { specificHour: 21 });
    expect(result.status).toBe('FAIL');
    expect(result.differences[0]?.path).toBe('entity.specificHour');
  });

  it('supports regex and one-of matchers', () => {
    const result = evaluateEntityGolden(testcase({
      location: { $regex: '^Ha' },
      timeOfDay: { $oneOf: ['Morning', 'Noon'] },
    }), {
      location: 'Hanoi',
      timeOfDay: 'Morning',
    });
    expect(result.status).toBe('PASS');
  });

  it('passes an explicitly absent entity golden', () => {
    const tc = testcase({});
    tc.expectedEntity = null;
    expect(evaluateEntityGolden(tc, undefined).status).toBe('PASS');
    expect(evaluateEntityGolden(tc, { location: 'Hanoi' }).status).toBe('FAIL');
  });
});
