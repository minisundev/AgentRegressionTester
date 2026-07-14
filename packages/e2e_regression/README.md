# e2e_regression

이 레포의 중심 패키지. YAML 테스트케이스를 읽어 에이전트 API(`agentChat` / `agentChatStream`)를
실제로 호출하고, 응답을 검증(resultCode, 인텐트, entity golden)한 뒤
터미널 / Google Sheet / Slack으로 리포트하는 **Jest 기반 E2E 회귀 러너**.

## 실행 (레포 루트에서)

모든 실행은 `scripts/run-test-profile.js`를 거친다. 선택자 형식:

```
terminal[:ai][:프로필]          # 터미널 리포트 (ai를 넣으면 로컬 judge)
sheet:<judge>[:프로필]          # 시트 리포트. judge = none|internal|api|gpt|local
```

```bash
npm run test:terminal:local                        # 터미널 출력, local 프로필
npm run test:sheet:none:local                      # 시트 기록, judge 없음
npm run test:profile -- sheet:gpt:local --mode sync    # GPT judge + sync 모드
npm run test:profile -- sheet:api:stg --mode stream    # Gemini judge + 스트리밍 모드
npm run test:profile -- terminal:local -- -t "Weather_Week_Matrix"   # jest -t 필터 passthrough
npm run test:profile -- --dry-run terminal:local   # 실행 없이 해석 결과만 확인
```

- **프로필** = 대상 환경. `config/settings/profiles.yaml`에서 `baseUrl`(에이전트 주소)과
  `sheetName`(시트 탭)을 정의한다. 현재: prod / stg / dev / local / crow.
  yaml에 없는 이름은 `.env`의 `CONTROL_BASE_URL_<대문자>`로도 정의 가능.
- **--mode**: `sync`(기본, agentChat) 또는 `stream`(agentChatStream, SSE — TTFT/토큰수 지표 추가).

## 동작 흐름

```
run-test-profile.js ─ REPORT_TO/JUDGE_MODE/REQUEST_MODE/CONTROL_BASE_URL 환경 구성
      ▼
jest → runner/agent.spec.ts
      │ 체크포인트 로드 (완료된 케이스 skip / 실패 행 재시도)
      │ 테스트케이스 로드: data/testcase_groups.ts의 CASE_GROUPS 목록
      │   (env TESTCASE_FILES로 오버라이드 가능 — prompt_optimizer가 사용)
      │ 실행 단위 구성: 싱글턴 = 케이스 1개 / 멀티턴 = 부모 id로 묶음
      │ 계정 레인 분배: PARALLEL_ACCOUNT_COUNT개의 레인, 레인당 계정 1개
      │   (한 계정을 두 유닛이 동시에 못 쓰게 promise chain으로 직렬화)
      ▼
케이스마다: buildRequestBody → agentChat(sync) 또는 agentChatStream(SSE)
      │  네트워크 에러는 무한 재시도 (5s→30s 지수 백오프)
      ▼
검증: resultCode==200? mainIntent=='Weather'? entityGolden PASS?
      │  (PUBLISH_AGENT_RESPONSE_STREAM=1이면 응답 스냅샷을 Redis로 발행)
      ▼
리포트: 시트 행 append/update (+judge, +번역 수식) / 터미널 표 / Slack 요약
      │  finally: agentChatEnd로 서버 컨텍스트 정리 (멀티턴은 마지막 턴에만)
      ▼
afterAll: RESULT_JSON_PATH가 있으면 성공/실패 전체를 JSON으로 기록 (prompt_optimizer용)
```

같은 디렉토리의 `runner/entityGolden.spec.ts`는 네트워크 없이 golden 매처만 검증하는
오프라인 단위 테스트로, 모든 실행에 함께 돈다.

## 테스트케이스 작성 — `config/testcases/*.yaml`

**활성 파일 목록은 `data/testcase_groups.ts`의 `CASE_GROUPS` 배열**에서 주석으로 켜고 끈다.

```yaml
groupName: AI_FTC_1001_Weather
cases:
  - id: 1
    name: "AI-FTC-1001 #001"
    message: Thời tiết hôm nay          # 실제 전송되는 발화
    reqTranslation: "..."               # (선택) 시트에 미리 채울 번역
    subIntent: CheckDailyForecast
    mainIntent: Weather
    agentType: DailyInfoAgent
    expectedEntity:                     # entity golden (아래 참고)
      reasoning: { $any: true }
      weatherMetric: all
      relativeDays: 0
      # ...
    entityMatchMode: exact              # exact | subset(기본)
```

**멀티턴**: `id: 2-1`, `id: 2-2`처럼 부모 id + 턴 번호로 짓고 각 턴에 `isMultiTurn: true`.
같은 부모의 턴들은 한 실행 단위로 묶여 같은 계정으로 순서대로 실행되고,
컨텍스트 정리는 마지막 턴 후에만 수행된다. 시트에서는 초록 배경으로 하이라이트.

### entity golden

응답의 `response.entity`를 기대값과 결정론적으로 비교한다:

- `expectedEntity` 미선언 → 상태 `NA` (검사 안 함)
- `expectedEntity: null` → entity가 **없어야** PASS
- `entityMatchMode: subset`(기본) → 선언한 필드만 검사, 나머지는 무시
- `entityMatchMode: exact` → 선언 안 된 필드가 있으면 `unexpected field`로 FAIL
- 리프 매처: `{ $any: true }`(아무거나), `{ $regex: "^Ha" }`, `{ $oneOf: [Morning, Noon] }`
- 실패 시 `entity.weekPart: expected=null, actual="whole" (value mismatch)` 형식의 diff가
  reason과 시트 U열에 기록되고 케이스는 FAIL 처리된다
- 비-200 응답이면서 entity가 없으면 FAIL이 아닌 `NA` (LLM 단계 전 거절 케이스)
- 레거시 `expect:` 블록은 golden으로 취급하지 않음

golden 일괄 생성은 `tsx scripts/generate-entity-goldens.ts` (레포 루트 README 참고 — YAML을 직접 수정하니 주의).

## Judge 모드 (`JUDGE_MODE`, 시트 리포트에서만 동작)

| 모드 | 무엇이 채점하나 | 시트 I열 |
|---|---|---|
| `none` | 채점 안 함 | 빈 칸 |
| `sheet` (선택자에선 `internal`) | Google Sheet 안의 `=GEMINI()` 함수 | 수식 (시트가 직접 평가) |
| `api` | Gemini API (`AI_API_KEY`, `AI_MODEL`) | 텍스트 판정 |
| `gpt` | Redis `config:llm:<GPT_JUDGE_LLM_ID>`의 GPT/Azure | 텍스트 판정 |
| `local` | 로컬 Ollama (`LOCAL_AI_MODEL`) | 텍스트 판정 |

judge 프롬프트: `config/prompts/prompt.ai.yaml`(api/gpt/local — 베트남어 TTS 답변용 A~J 체크리스트 루브릭),
`prompt.sheet.yaml`(sheet 모드). `TODAY` env로 judge의 기준 날짜를 mock할 수 있다 (안 주면 실제 시계).

## 리포트

- **터미널**: 성공/실패 요약 표 (cli-table3).
- **Google Sheet**: 프로필의 `sheetName` 탭에 A~U 컬럼으로 기록.
  A group / B id / C·D intent / E request / F response / G·H 번역(=GOOGLETRANSLATE 또는 GPT) /
  I judge / J time / K reason / L testedAt / M entity / N·O 카드 / P mode / Q ttft / R tokenCount /
  S expectedEntity / T entityGoldenStatus / U entityGoldenDiff.
  탭이 없으면 자동 생성 (`config/settings/sheet.yaml`의 `wrapColumns`에 WRAP 적용).
- **Slack**: `SLACK_WEBHOOK_URL` 설정 시 총계/성공/실패/pass rate + 상위 5개 실패 사유.
- **JSON** (`RESULT_JSON_PATH`): `{runId, passCount, failCount, successes[], failures[]}` — prompt_optimizer 연동용.

## 체크포인트 — `.checkpoint.json`

- runId = `시트탭이름-YYYY-MM-DD`. 같은 runId로 재실행하면 **성공한 케이스는 skip**,
  실패했던 케이스는 같은 시트 행을 업데이트하며 재시도. runId가 바뀌면 초기화.
- 중간에 끊긴 대량 실행을 이어 돌리는 용도. 전부 다시 재고 싶으면 파일 삭제.
- `CHECKPOINT_FILE` env로 경로를 바꿀 수 있다 — prompt_optimizer가 격리용으로 사용.
- 멀티턴 유닛은 재개 시 서버 컨텍스트 재구성을 위해 앞 턴을 다시 실행하되 시트에 중복 기록하지 않음.

## Redis 연동 (model_payload_test와의 접점)

`PUBLISH_AGENT_RESPONSE_STREAM=1`이면 매 응답 스냅샷(요청/응답/entity golden 결과)을
`weather:agent-response` 스트림에 XADD하고 `weather:agent-response:trx:<trxId>` 키에
TTL(`AGENT_RESPONSE_CACHE_TTL_SEC`, 기본 3600초)로 캐시한다.
model_payload_test watcher가 이걸 trxId로 join해서 end-to-end 감사 리포트를 만든다.

## 주요 환경변수

| 변수 | 설명 |
|---|---|
| `CONTROL_BASE_URL` (필수) / `X_API_KEY` (필수) | 에이전트 주소(프로필이 덮어씀) / API 키 |
| `REPORT_TO` / `JUDGE_MODE` / `REQUEST_MODE` | 선택자가 설정 (terminal\|sheet / none\|sheet\|api\|gpt\|local / sync\|stream) |
| `PARALLEL_ACCOUNT_COUNT` (기본 5) | 병렬 계정 레인 수 (1~50) |
| `ACCOUNT_ID` / `AGENT_VERSION` / `LANGUAGE` / `DEVICE_ID` 등 | 요청 body/헤더 값 |
| `TEST_TIMEOUT_SEC` (기본 3000) | 케이스 타임아웃 |
| `TODAY` | judge 기준 날짜 mock (`WED,2026.06.17` 형식) — 평소엔 비워둘 것 |
| `GOOGLE_SHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` | 시트 인증 (REPORT_TO=sheet 시 필수) |
| `GOOGLETRANSLATE_SOURCE_LANGUAGE` / `_TARGET_LANGUAGE` | 시트 번역 수식 언어 |
| `RESPONSE_TRANSLATION_PROVIDER` | googletranslate(수식) \| gpt(`RESPONSE_TRANSLATION_LLM_ID` 필요) |
| `AI_API_KEY` / `AI_MODEL` | JUDGE_MODE=api용 Gemini |
| `GPT_JUDGE_LLM_ID` / `GPT_JUDGE_MAX_TOKEN` | JUDGE_MODE=gpt용 (Redis config:llm 참조) |
| `LOCAL_AI_MODEL` / `LOCAL_AI_TEMPERATURE` / `LOCAL_AI_MAX_TOKEN` | JUDGE_MODE=local용 Ollama |
| `SLACK_WEBHOOK_URL` | 설정 시 Slack 리포트 |
| `PUBLISH_AGENT_RESPONSE_STREAM` / `WEATHER_AGENT_RESPONSE_STREAM_KEY` | 응답 스냅샷 발행 |
| `RESULT_JSON_PATH` / `TESTCASE_FILES` / `CHECKPOINT_FILE` | prompt_optimizer 연동 (JSON 결과 / 케이스 파일 오버라이드 / 체크포인트 격리) |
| `SERVICE_DELAY_SEC` | 선언만 되어 있고 현재 미사용 (예약) |

## 디렉토리 구조

```
runner/            agent.spec.ts (E2E), entityGolden.spec.ts (오프라인 매처 테스트)
client/            Client.ts (sync + agentChatEnd), streamClient.ts (SSE)
core/              runCase.ts, resultHandlers.ts (레거시 단순 실행 경로)
utils/             entityGolden(golden 비교), googleSheet, slack, ai(judge),
                   checkpoint, testcaseLoader, accountId(레인 계정),
                   agentResponsePublisher(Redis 발행), networkRetry, responseTranslator …
config/testcases/  케이스 yaml (활성 목록: data/testcase_groups.ts)
config/prompts/    judge/번역 프롬프트 yaml
config/settings/   profiles.yaml(환경), sheet.yaml(시트 wrap), usage.yaml(도움말)
data/              testcase_groups.ts(CASE_GROUPS), weather.ts(deprecated)
```
