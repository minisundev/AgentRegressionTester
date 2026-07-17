# personal_e2e — aia-personal (Calendar / Reminder / Alarm) 회귀 테스트

weather 용 `e2e_regression` 과 별개인 패키지. 대상 에이전트가 **멀티턴 슬롯필링**과
**단말(디바이스) 콜백**이라는 두 가지 다른 프로토콜을 쓰기 때문에 러너를 분리했다.

## 실행

```bash
# .env 에 추가 (값은 aia-personal web/_middle.py 의 헤더 체크 값)
#   PERSONAL_X_API_KEY=...
#   PERSONAL_BASE_URL=http://localhost:8080/aia-personal/v1   # 기본값
#   REDIS_URL=...   # aia-personal 이 쓰는 것과 같은 Redis (콜백 시뮬레이터용)

npm run test:personal                              # 전체 스모크 (터미널 리포트)
PERSONAL_CASE_FILTER=CAL-C02 npm run test:personal # 케이스 필터
PERSONAL_CASE_GROUPS=ai_ftc_personal.yaml npm run test:personal  # FTC 시트 케이스

# 구글 시트 리포트 (weather e2e 와 같은 GOOGLE_* 서비스 계정/시트 재사용,
# PERSONAL_SHEET_NAME 탭(기본 personal_e2e)에 턴 단위로 append)
PERSONAL_REPORT_TO=sheet npm run test:personal
```

시트 컬럼: testedAt / group / caseId / caseName / turn(n/N) / agentType /
reqIntent / restoredIntent / request / response / entity / slot_complete / lock /
events / resultCode / resultMessage / checkFailures / turnResult / caseResult / time / ttft

판정 기준 (turnResult): `resultCode==200` && 전송 에러 없음 && **답변 검사 통과**.
답변 검사는 ① 자동 날짜포맷 린트 — 답변에 ISO(YYYY-MM-DD) 노출, entity.date 대비
MM/DD/YYYY 뒤집힘, VI 답변의 영어 월 이름을 잡는다 (상대 표현만 있으면 통과,
`expect.skipDateLint: true` 로 턴별 비활성화). ② YAML `expect.messageMatches` /
`messageNotMatches` 정규식.

## 이 에이전트의 프로토콜 (weather 와 다른 점)

`POST {base}/personalStream` (SSE). 요청 바디는 weather 와 같은 모양이지만 의미가 다르다:

1. **mainIntent / subIntent 는 요청 입력이다.** 운영에선 상위 aia-control NLU 가 분류해서
   넣어주는 값이라, 직접 붙는 테스트에서는 케이스 YAML 이 턴마다 지정해야 한다.
   지원 값 (`agent/lib/personal_entity.py` 기준):
   - `Calendar`: `CreateEvent` / `ViewEvent` / `RemoveEvent`
   - `Reminder`: `Create` / `ViewList` / `Remove`
   - `Alarm`: `Create` / `ViewList` / `Remove` / `ActivateSetting` / `DeactivateSetting`

2. **슬롯필링 = CONVERSATION_LOCK.** 필수 슬롯이 비면 에이전트가
   `EVENT {eventCode: CONVERSATION_LOCK, conversationLock: "Y", conversationId}` 를 내리고
   대화 상태를 Redis(`message:{encId}:conv:{convId}`)에 저장한다.
   다음 턴은 **`agentType: PersonalConAgent` + 그 `conversationId`** 로 보내고,
   이때 mainIntent/subIntent 는 **`Personal` / `Conversation` 고정** — 생략(null)하면
   서버가 프롬프트 파일 `conv_None_None.yaml` 을 찾다 500 이 난다.
   (conv_route 노드가 요청 바디의 인텐트로 `conv_{main}_{sub}.yaml` 을 열고,
   LIST/CONFIRM 모드는 서버가 subIntent 를 List/Confirm 으로 덮어써 해당 파일을 연다.)
   실제 업무 인텐트는 서버가 대화 상태에서 복원해 INTENT 프레임으로 알려준다
   (리포트의 `restored=` 표기).
   슬롯이 다 차면 `DATA {slot_complete: "Y", entity}` 와 `conversationLock: "N"` 이 온다.
   한 턴 안에 Y 후 N 이 올 수도 있으므로 항상 마지막 수신값 기준이다.
   → 러너(`runner/run.ts`)가 이 잠금 상태를 자동으로 추적한다. YAML 은 턴만 나열하면 됨.

3. **단말 콜백.** 실제 일정/알람 데이터는 단말에 있어서, 에이전트가
   `EVENT {eventCode, callbackId}` 를 내리고 Redis 채널 `callback:{callbackId}` 를
   **3초** 구독한다. 응답이 없으면 `AgentCallbackError`.
   테스트에서는 `client/deviceSimulator.ts` 가 단말인 척 publish 한다:

   | eventCode | 시뮬레이터 응답 | YAML `mock:` 필드 |
   |---|---|---|
   | `GET_COUNT` | `{totalCount}` | `totalCount` (기본 0) |
   | `CHECK_DUPLICATE` | `{totalCount, duplicateCount}` | `totalCount`, `duplicateCount` (기본 0/0) |
   | `GET_USER_QUERY` | `{listCount, list}` | `list` (기본 `[]`) |

   응답의 `eventCode` 는 받은 이벤트와 동일해야 한다(불일치 → 364406). 시뮬레이터가 echo 처리.

   `mock.list` 아이템에서 서버가 실제 쓰는 필드:
   - `itemId` (문자열 권장) — 삭제/활성/비활성 **확정 시 이 값이 그대로 entity 로 나온다** → 필수
   - `isActive`("Y"/"N") — 알람 활성/비활성 개수 계산용
   - `recurring`("Y"/"N") — 확인 멘트의 반복 표기용
   - title/date/time 등 나머지는 카드·LLM 답변용

   응답 개수에 따른 동작(삭제 기준): `listCount==1` → 바로 CONFIRM 재질의,
   `>1` → 카드 리스트 + 번호선택/확인 재질의, `0` → "없다"로 종료(잠금 없음).
   그래서 **삭제 케이스는 마지막에 "Ừ"/"Yes" CONFIRM 턴이 있어야 완결**된다.
   비워두면 "없다" 응답으로 끝난다.

4. **STM(대화 히스토리)은 accountId 해시로 Redis 에 남는다.**
   러너가 케이스마다 `{ACCOUNT_ID}-{caseId}-{ts}` 로 고유 accountId 를 만들어 오염을 막는다.
   한 케이스(대화) 안에서는 모든 턴이 같은 accountId — 턴마다 바뀌면 364404.

5. **에러 코드와 러너의 상태머신 처리** (`core/exception/agent_exception.py`):

   | code | 의미 | 러너 처리 |
   |---|---|---|
   | 364404 | Invalid Conversation ID | convId 폐기 → 다음 턴 IDLE 재시작 |
   | 364405 | Unsupported Utterance (LOCKED 중 새 주제) | 서버가 잠금 해제, convId 폐기 |
   | 364406 | Callback Error (3초 미응답/eventCode 불일치) | convId 폐기, Redis 연결 점검 필요 |
   | 364407 | History State Error | convId 폐기 |
   | 364408 | LLM Adaptor Error | 같은 턴 1회 자동 재시도 |

   비 200 턴은 FAIL 로 기록하되 케이스는 계속 진행한다(전송 오류만 중단).

## 케이스 YAML 형식

```yaml
groupName: Personal_Smoke
cases:
  - id: CAL-C02
    name: "Calendar create - 슬롯필링"
    language: vietnamese        # vietnamese | english (기본 PERSONAL_LANGUAGE)
    turns:
      - message: "Đặt lịch đi làm sáng mai"
        mainIntent: Calendar
        subIntent: CreateEvent
      - message: "9 giờ"        # 잠금 상태면 자동으로 PersonalConAgent 로 감
        mainIntent: Calendar    # 기록용 (잠금 턴에선 서버가 conv 상태의 intent 를 씀)
        subIntent: CreateEvent
        mock:                   # 이 턴에서 오는 단말 콜백에 대한 응답 목업
          totalCount: 3
```

expectedEntity 골든은 아직 없다 — 러너는 턴별 `entity` / `slot_complete` / lock 흐름과
`resultCode==200` 만 판정한다. 골든을 붙이려면 `runner/run.ts` 의 `runCase` 에서
`TurnResult.entity` 를 비교하는 단계를 추가하면 된다.

## 주의

- **weather 테스트와 Redis/서버를 공유하지 않지만**, aia-personal 의 Redis 와는 공유한다.
  콜백 publish 가 늦으면(느린 네트워크/원격 Redis) 3초 타임아웃에 걸릴 수 있다.
- 케이스는 순차 실행이다(멀티턴 + 콜백 특성상 병렬화 이득이 적음).
- `ALM-M01` 같은 긴 시나리오는 시트의 한 셀을 그대로 옮긴 것 — 실패 분석이 어려우면 쪼갤 것.
