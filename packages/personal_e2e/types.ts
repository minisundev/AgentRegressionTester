// aia-personal (Calendar / Reminder / Alarm) 에이전트용 테스트 타입.
// weather와 달리 이 에이전트는 mainIntent/subIntent를 요청에 담아 보내야 하고
// (상위 aia-control NLU가 하던 일을 테스트가 대신함), 슬롯이 비면
// CONVERSATION_LOCK으로 대화를 잠근 뒤 후속 턴을 PersonalConAgent로 받는다.

export type PersonalLanguage = 'vietnamese' | 'english';

/** 디바이스(단말)가 콜백으로 돌려줄 값의 목업. 턴 단위로 지정한다. */
export interface TurnMock {
  /** GET_COUNT / CHECK_DUPLICATE 응답의 totalCount (기본 0) */
  totalCount?: number;
  /** CHECK_DUPLICATE 응답의 duplicateCount (기본 0) */
  duplicateCount?: number;
  /** GET_USER_QUERY 응답의 list. listCount는 길이로 계산 (기본 []) */
  list?: Record<string, unknown>[];
}

/** 턴 답변(=TTS 텍스트)에 대한 검증 조건 */
export interface TurnExpect {
  /** 정규식 문자열 — 전부 답변에 매치되어야 함 */
  messageMatches?: string[];
  /** 정규식 문자열 — 하나라도 매치되면 실패 */
  messageNotMatches?: string[];
  /** true 면 이 턴에서 자동 날짜포맷 린트를 끔 (기본 켜짐) */
  skipDateLint?: boolean;
}

export interface PersonalTurn {
  message: string;
  /** Calendar | Reminder | Alarm */
  mainIntent: string;
  /**
   * Calendar: CreateEvent / ViewEvent / RemoveEvent
   * Reminder: Create / ViewList / Remove
   * Alarm:    Create / ViewList / Remove / ActivateSetting / DeactivateSetting
   * 대화 잠금(PersonalConAgent) 상태의 턴에서는 서버가 무시하지만 기록용으로 채워둔다.
   */
  subIntent: string;
  mock?: TurnMock;
  expect?: TurnExpect;
  note?: string;
}

export interface PersonalCase {
  id: string | number;
  name: string;
  language?: PersonalLanguage;
  turns: PersonalTurn[];
}

export interface PersonalCaseGroup {
  groupName: string;
  cases: PersonalCase[];
  sourceFile: string;
}

/** SSE EVENT 중 디바이스 콜백을 요구하는 이벤트 */
export interface DeviceEvent {
  eventCode: string; // GET_COUNT | CHECK_DUPLICATE | GET_USER_QUERY
  callbackId: string;
  entity?: Record<string, unknown>;
}

export interface TurnResult {
  turnIndex: number;
  request: string;
  agentType: string;
  mainIntent: string;
  subIntent: string;
  /** 멀티턴 시 INTENT 프레임으로 서버가 복원해준 인텐트 */
  serverMainIntent?: string;
  serverSubIntent?: string;
  resultCode: number;
  resultMessage: string;
  messageText: string;
  entity?: Record<string, unknown>;
  slotComplete?: string; // 'Y' | 'N'
  cardShow?: string;
  conversationLock: 'Y' | 'N' | null;
  conversationId: string | null;
  deviceEvents: DeviceEvent[];
  ttft?: number;
  tokenCount: number;
  totalTime: number;
  /** 답변 검증(날짜포맷 린트 + expect 정규식) 실패 사유들. 비어있어야 PASS */
  checkFailures: string[];
  error?: string;
}

export interface CaseResult {
  group: string;
  id: string | number;
  name: string;
  turns: TurnResult[];
  pass: boolean;
}
