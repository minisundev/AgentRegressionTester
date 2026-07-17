import { PersonalLanguage, PersonalTurn } from './types';

const EN_MONTHS =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;

/**
 * 답변(=TTS 텍스트) 검증.
 *  - 자동 날짜포맷 린트: 베트남 서비스 표기 규칙은 DD/MM/YYYY.
 *    · ISO(YYYY-MM-DD) 날짜가 답변에 노출되면 실패
 *    · entity.date 와 대조해 MM/DD/YYYY 로 뒤집혀 있으면 실패
 *    · vietnamese 답변에 영어 월 이름(July 15 …)이 나오면 실패
 *    (상대 표현(hôm nay/ngày mai)만 있고 명시 날짜가 없으면 검사 대상 없음 → 통과)
 *  - expect.messageMatches / messageNotMatches 정규식 검사
 */
export function runTurnChecks(
  turn: PersonalTurn,
  messageText: string,
  entity: Record<string, unknown> | undefined,
  language: PersonalLanguage,
): string[] {
  const failures: string[] = [];
  if (!messageText) return failures;

  if (!turn.expect?.skipDateLint) {
    failures.push(...dateFormatViolations(messageText, entity, language));
  }

  for (const pattern of turn.expect?.messageMatches ?? []) {
    if (!new RegExp(pattern, 'iu').test(messageText)) {
      failures.push(`messageMatches 불일치: /${pattern}/`);
    }
  }
  for (const pattern of turn.expect?.messageNotMatches ?? []) {
    if (new RegExp(pattern, 'iu').test(messageText)) {
      failures.push(`messageNotMatches 위반: /${pattern}/`);
    }
  }
  return failures;
}

function dateFormatViolations(
  messageText: string,
  entity: Record<string, unknown> | undefined,
  language: PersonalLanguage,
): string[] {
  const violations: string[] = [];

  const iso = messageText.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (iso) violations.push(`답변에 ISO 날짜 노출: ${iso[0]} (기대: DD/MM/YYYY)`);

  if (language === 'vietnamese' && EN_MONTHS.test(messageText)) {
    violations.push(`VI 답변에 영어 월 이름 노출: ${messageText.match(EN_MONTHS)![0]}`);
  }

  // entity.date(YYYY-MM-DD)가 있으면 답변의 표기 방향을 확정적으로 대조할 수 있다.
  const entityDate = typeof entity?.date === 'string' ? entity.date : undefined;
  const m = entityDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, mo, d] = m;
    if (mo !== d) {
      // 월≠일일 때만 MM/DD 와 DD/MM 를 구분할 수 있다.
      const flipped = [`${mo}/${d}/${y}`, `${Number(mo)}/${Number(d)}/${y}`];
      for (const bad of flipped) {
        if (messageText.includes(bad)) {
          violations.push(`답변 날짜가 MM/DD/YYYY 로 뒤집힘: ${bad} (기대: ${d}/${mo}/${y})`);
          break;
        }
      }
    }
  }
  return violations;
}
