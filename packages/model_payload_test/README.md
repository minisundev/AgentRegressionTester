# model_payload_test

날씨 에이전트가 **자기 LLM을 호출하기 직전의 payload**(프롬프트 + 유저 메시지 + 날씨 데이터)를
Redis Stream으로 받아서, 같은 payload를 **여러 모델/온도에 팬아웃**해 답변을 나란히 비교하는 상시 watcher.
선택적으로 GPT judge 2종(답변 충실도 / payload 정책)과 실제 API 응답 join까지 붙여
터미널 또는 Google Sheet에 비교 리포트를 남긴다.

**언제 쓰나**: 모델/온도 선정 실험("이 질의 유형엔 어떤 모델+온도가 최적인가"),
payload 구성 자체의 감사(인텐트 라우팅·엔티티 추출·카드 선택이 맞는가),
답변이 공급된 날씨 데이터를 왜곡(hallucination)하는지 탐지.

## 실행 (레포 루트에서)

```bash
npm run watch:weather:answer-compare                      # 터미널 출력만
REPORT_TO=sheet npm run watch:weather:answer-compare      # Google Sheet에도 기록
READ_EXISTING_PAYLOADS=1 npm run watch:weather:answer-compare   # 스트림의 기존 항목부터 소비

# judge까지 켜기
REPORT_TO=sheet EVALUATE_WITH_GPT=1 EVALUATE_PAYLOAD_WITH_GPT=1 npm run watch:weather:answer-compare
```

무한 루프로 돌며(Ctrl+C로 종료), 스트림에 payload가 들어올 때마다 처리한다.
전제: 에이전트 서비스 쪽에서 answer payload를 스트림으로 발행하도록 켜져 있어야 한다.

## 동작 흐름

```
[에이전트 서비스] --XADD--> Redis Stream "weather:answer-compare" (field: payload JSON)
                                     │ XREADGROUP (group: weather-answer-compare, consumer: watcher-1)
                                     ▼
        ┌──────────── watcher (runner/weatherAnswerCompare.ts) ────────────┐
        │ 1. payload 민감정보 마스킹 (auth_key/api_key/token → [REDACTED]) │
        │ 2. answerCompare.yaml의 case들로 병렬 LLM 호출                    │
        │    (GPT/Azure, Gemini 온도 스윕, 원격 Gemma)                     │
        │ 3. (JOIN=1) 같은 trxId의 실제 API 응답을 join                    │
        │ 4. (EVALUATE=1) GPT judge: 답변 충실도 / payload 정책            │
        │ 5. 터미널 한 줄 요약 + (sheet면) 시트 행 append → XACK           │
        └────────────────────────────────────────────────────────────────┘
```

- 처리 실패한 항목은 ACK하지 않고 `PENDING_RETRY_INTERVAL_MS`(기본 30초)마다 재시도한다.
  영구히 깨진 payload는 계속 재시도 로그를 남기니 필요하면 수동 XACK.
- payload의 `subIntent`로 시트 Group을 유추 (`CheckDailyForecast→DailyForecast` 등).

## 비교 케이스 정의 — `config/answerCompare.yaml`

```yaml
cases:
  - key: gpt54          # 결과 키 (유일, 공백 금지)
    label: GPT-5.4 t0   # 시트 컬럼 그룹 라벨
    provider: gpt       # gpt | gemini | gemma
    llmId: 6            # Redis config:llm:<id> (생략 시 *_TEST_LLM_ID env)
    temperature: 0
  - key: gemini_t03
    label: Gemini t0.3
    provider: gemini
    llmId: 8
    temperature: 0.3
    thinkingLevel: minimal   # gemini 전용
```

기본 구성: GPT-5.4(t0) + Gemini(llmId 8) 온도 스윕 t0/0.3/0.5/0.7/1.0.
`ANSWER_COMPARE_CONFIG` env로 다른 yaml 경로를 지정할 수 있다.

모델 접속 정보는 전부 Redis `config:llm:<id>`에서 해석한다 (`npm run llm:list`로 확인).
GPT5 계열은 temperature 미지원이라 `max_completion_tokens`만 적용됨. 모든 HTTP 호출 타임아웃 120초.

## Judge

### 답변 judge (`EVALUATE_WITH_GPT=1`)

각 케이스 응답을 "supplied weather data에 충실한가"로 채점.
카테고리: DATA_FIDELITY, TEMPORAL_ALIGNMENT, SUMMARY_AGGREGATION, UNSUPPORTED_INFERENCE,
ADVICE_POLICY, AVAILABILITY_HANDLING, FIELD_MAPPING.
반환: verdict(pass|fail|borderline) + score(0-100) + 카테고리별 이슈 + 한국어 요약.
`EVALUATE_CASE_KEYS=gemini_t0,gemini_t03`으로 특정 케이스만 채점 가능.

### payload judge (`EVALUATE_PAYLOAD_WITH_GPT=1`)

LLM 이전 단계(파이프라인)가 맞았는지를 유저 질의 vs payload로 채점.
인텐트 라우팅, timeOfDay 시간대 매핑, next-time fallback, 범위 클램핑, 멀티턴 상속,
카드 선택/내용, 단계 간 일관성 등을 체크. entityGolden diff가 있으면 강한 증거로 사용.
verdict에 `not_evaluable`(LLM 단계 전 거절 등)이 따로 있다.

## API 응답 join (end-to-end 감사)

회귀 러너(e2e_regression) 쪽에서 `PUBLISH_AGENT_RESPONSE_STREAM=1`로 실제 API 응답 스냅샷을
`weather:agent-response` 스트림 + `weather:agent-response:trx:<trxId>` 캐시(TTL `AGENT_RESPONSE_CACHE_TTL_SEC`, 기본 3600초)에 발행하면,
이 watcher에서 `JOIN_AGENT_RESPONSE_STREAM=1`을 켜서 trxId로 join한다 (`AGENT_RESPONSE_JOIN_TIMEOUT_MS` 기본 10초 폴링).
join되면 시트에 API 응답/entity/카드들과 entity golden 상태까지 같은 행에 기록된다.

## Redis 키/스트림 정리

| 키 | 방향 | 내용 |
|---|---|---|
| `weather:answer-compare` (stream) | 소비 | field `payload` = DumpedPayload JSON (trxId, prompt, userMessage, weatherData, llmParams…) |
| `config:llm:<id>` | 읽기 | 모델 엔드포인트 설정 {url, group, version, auth_key, llm_deploy} |
| `weather:agent-response` (stream) / `weather:agent-response:trx:<trxId>` | 읽기(join) | 회귀 러너가 발행한 실제 API 응답 스냅샷 |

## 환경변수

| 변수 | 기본 | 설명 |
|---|---|---|
| `REDIS_URL` 또는 `REDIS_ENDPOINT`/`REDIS_PORT`/`REDIS_PASSWD`/`REDIS_SSL` | 127.0.0.1:6379 | Redis 접속 |
| `WEATHER_ANSWER_COMPARE_STREAM_KEY` / `_GROUP` / `_CONSUMER` | weather:answer-compare / weather-answer-compare / watcher-1 | 소비 스트림 |
| `ANSWER_COMPARE_REPORT_TO` (폴백 `REPORT_TO`) | terminal | `sheet`면 시트 기록 |
| `READ_EXISTING_PAYLOADS` | 0 | 1이면 스트림 기존 항목부터 |
| `STREAM_BLOCK_MS` / `PENDING_RETRY_INTERVAL_MS` | 5000 / 30000 | 폴링/재시도 주기 |
| `GPT_TEST_LLM_ID` / `GEMMA_TEST_LLM_ID` / `GEMINI_TEST_LLM_ID` | 6 / 2 / 8 | case에 llmId 없을 때 기본 |
| `GEMMA_TEST_MODEL` | mediaai1/gemma-27b-generation-v3.0.0 | Gemma 모델명 |
| `EVALUATE_WITH_GPT` / `EVALUATE_PAYLOAD_WITH_GPT` | 0 / 0 | judge 활성화 |
| `GPT_JUDGE_LLM_ID` | GPT_TEST_LLM_ID | judge 모델 |
| `EVALUATE_CASE_KEYS` | (전부) | 채점할 케이스 제한 |
| `JOIN_AGENT_RESPONSE_STREAM` | 0 | API 응답 join |
| `WEATHER_AGENT_RESPONSE_STREAM_KEY` | weather:agent-response | join 스트림 |
| `AGENT_RESPONSE_CACHE_TTL_SEC` / `AGENT_RESPONSE_JOIN_TIMEOUT_MS` | 3600 / 10000 | join 캐시/대기 |
| `ANSWER_COMPARE_CONFIG` | config/answerCompare.yaml | 케이스 yaml 경로 |
| `GOOGLE_SHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` | — | 시트 인증 (없으면 skip) |
| `GOOGLE_SHEET_TAB` | WeatherAnswerCompare | 시트 탭 |
| `GOOGLETRANSLATE_SOURCE_LANGUAGE` / `_TARGET_LANGUAGE` | auto / ko | 시트 번역 수식 |

## 시트 출력 구조

- 메타: Tested At, Group, ID, Message(+번역), SubIntent, Language, Weather Data, User Message
- 케이스별 반복: `<label>` Model / Response / Response Translation / Judge Verdict / Score / Categories / Summary / Issues / Judge Error / Latency / Error
- 꼬리: Service Response(+번역), Dumped Payload, Prompt, API Result Code, API Entity, Expected Entity, Entity Golden Status/Diff, API Today/Hourly/Weekly Card, Payload Judge 결과 일체

번역 컬럼은 `=GOOGLETRANSLATE()` 수식으로 들어가고, 새 컬럼은 항상 끝에 추가되어 기존 열이 밀리지 않는다.

## 경향성 분석 — `analyzer/`

시트에 쌓인 answer-compare 결과를 읽어 할루시네이션이 어디서 발생하는지 집계한다 (시트 원본은 읽기만).

```bash
npm run analyze:hallucination                          # 기본: HallucinationT0 탭, 클러스터링+시트 기록 포함
npm run analyze:hallucination -- --no-sheet --no-cluster --tab <탭이름>
```

- 측정: 모델별 fail/borderline율·score 분포, 카테고리×severity 매트릭스, 발생 조건 슬라이스
  (group/subIntent/language + Weather Data에서 파생한 forecastScope/format/dataPoints/availability/aggregation, n≥5 + lift),
  모델 단독 실패 vs 전 모델 실패, answer fail × payload judge 교차, judge LLM 클러스터링 기반 반복 패턴 Top-N.
- 케이스 컬럼 그룹은 헤더의 `<label> Judge Verdict` 패턴으로 자동 감지되고, 같은 trxId는 최신 행만 남긴다.
  모델 호출/judge 에러 행은 분모에서 제외하고 데이터 품질 섹션에 따로 보고한다.
- 출력: 터미널 요약 + `analysis_runs/<타임스탬프>_<탭>/`(report.md, parsed.json, metrics.json, gitignore됨)
  + 같은 스프레드시트의 `<탭>_Analysis` 탭(clear 후 재작성).
- 클러스터링은 judge와 같은 `GPT_JUDGE_LLM_ID`를 쓰므로 Redis가 필요하다. `--no-cluster`면 Redis 없이 동작.

## 주의

- `.env.example`의 `GPT_TEST_LLM_ID=3`과 코드 기본값 6이 다르다 — 실제 기준은 yaml의 `llmId` + Redis.
- `.env.example`에 Ollama 변수가 있지만 현재 provider 분기는 `gpt|gemini|gemma`뿐 (ollama 미연결).
- judge/시트로 나가기 전 payload의 인증 키 계열 필드는 재귀적으로 `[REDACTED]` 처리된다.
