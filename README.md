# Agent Regression Tester

> LLM 에이전트의 불확실한 응답 품질을 자동화된 파이프라인으로 검증하고 관리합니다.

### Why This Project?

LLM 에이전트 개발은 일반적인 백엔드 개발과 다릅니다. 프롬프트 한 줄, 소스코드 한 줄의 수정이 수백 개의 테스트 케이스에 어떤 영향을 줄지 예측하기 어렵습니다.
이 프로젝트는 "딱 떨어지지 않는 LLM 응답"을 효율적으로 검증하기 위해 시작되었습니다. 매일 반복되는 수동 테스트와 번역 작업을 자동화하고, 나아가 **테스트 → 프롬프트 수정 → 반영 → 재측정**의 개선 루프 전체를 자동화합니다.

### Impact

- **검증 리소스 95.8% 절감:** 기존 8시간 소요되던 전수 검사를 20분 내외(검토 시간 기준)로 단축.
- **품질 안정성 확보:** 수백 개의 케이스를 상시 검증하여 공식 시연 및 UAT 리스크 최소화.

---

## 시스템 구성

```
                        ┌──────────────────────────────────────────────┐
                        │              에이전트 서버 (외부)              │
                        │   agentChat / agentChatStream  ← Redis 참조   │
                        └───────▲──────────────────────────▲───────────┘
                                │ API 호출                  │ llm_prompt:* / config:llm:*
  ┌─────────────────────────────┴───┐              ┌───────┴────────────────────────┐
  │ e2e_regression                  │              │ Redis                          │
  │ YAML 케이스 → API 호출 → 검증    │              │   ▲ 파일 sync    ▲ DB sync      │
  │ (entity golden, judge)          │              │ prompt_update   db_to_redis    │
  │ → 시트/슬랙/터미널/JSON 리포트   │              │ (prompts/*.md)  (PostgreSQL)   │
  └───────▲─────────────────────────┘              └────────────────────────────────┘
          │ 실패 수집 / 재측정
  ┌───────┴─────────────────────────┐   ┌────────────────────────────────────────┐
  │ prompt_optimizer                │   │ model_payload_test                     │
  │ 실패 분석 → LLM 수정안           │   │ LLM 직전 payload 스트림 소비            │
  │ → prompt_update로 반영 → 재측정  │   │ → 멀티모델/온도 비교 + GPT judge        │
  └─────────────────────────────────┘   └────────────────────────────────────────┘
                                        ┌────────────────────────────────────────┐
                                        │ cache_probe: 게이트웨이 캐시 정합성 프로브 │
                                        └────────────────────────────────────────┘
```

| 패키지 | 역할 | 상세 |
|---|---|---|
| [`packages/e2e_regression`](packages/e2e_regression/README.md) | E2E 회귀 러너 — YAML 케이스로 에이전트 API 검증, 시트/슬랙 리포트 | 이 레포의 중심 |
| [`packages/prompt_update`](packages/prompt_update/README.md) | `prompts/*.md` 파일 → Redis 프롬프트 실시간 반영 서버 (8083) | 파일이 소스 오브 트루스 |
| [`packages/prompt_optimizer`](packages/prompt_optimizer/README.md) | 프롬프트 자동 개선 루프 (실패 수집 → LLM 수정안 → 반영 → 재측정 → 채택/롤백) | flaky 분리, 온도 프로브 포함 |
| [`packages/db_to_redis`](packages/db_to_redis/README.md) | PostgreSQL(CMS) → Redis 동기화 서버 (8082) | 캐시/프롬프트/LLM 설정 |
| [`packages/model_payload_test`](packages/model_payload_test/README.md) | LLM 직전 payload를 스트림으로 받아 멀티모델/온도 비교 + judge | 상시 watcher |
| [`packages/cache_probe`](packages/cache_probe/README.md) | api-gateway 날씨 캐시 정합성 증거 수집 프로브 | 포렌식 도구 |

프롬프트 원본은 레포 루트 `prompts/*.md` + 매핑 선언 `prompts/manifest.yaml`,
에이전트 정책 문서는 `spec/weather_agent_policy.md`,
프롬프트 변경 이력(왜/어떻게)은 `prompts/CHANGELOG.md`에 있다.

---

## Setup

### 1. 설치

```bash
npm install                                # 루트 (e2e_regression, optimizer, watcher, probe 공용)
cd packages/prompt_update && npm install   # 서버 패키지는 개별 설치
cd packages/db_to_redis && npm install
```

### 2. `.env` 설정

루트 `.env`(예시는 아래 "환경변수 채우는 법" 참고)와 각 서버 패키지의 `.env`(`.env.example` 참고)를 작성한다.
**`.env`는 절대 커밋 금지.**

필수 최소 셋:

```bash
# 루트 .env
CONTROL_BASE_URL="http://localhost:8080/aia-control/v1/agentChat"   # 프로필 미사용 시 폴백
X_API_KEY=""
AI_API_KEY=""            # Gemini (judge, prompt_optimizer)
REDIS_URL="redis://127.0.0.1:6379"
# 시트 리포트를 쓰려면: GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY
# 슬랙 알림을 쓰려면: SLACK_WEBHOOK_URL
```

### 3. 환경(프로필) 정의 — `packages/e2e_regression/config/settings/profiles.yaml`

```yaml
profiles:
  local:
    baseUrl: http://localhost:8080/aia-control/v1/agentChat
    sheetName: local_260714
  stg:
    baseUrl: https://…-staging…/aia-control/v1/agentChat
    sheetName: stg_260627
```

새 환경은 여기에 추가만 하면 코드 수정 없이 `test:*:<프로필>`로 바로 쓸 수 있다.

---

## 실행 치트시트

### 회귀 테스트 (e2e_regression)

선택자: `terminal[:ai][:프로필]` 또는 `sheet:<judge>[:프로필]` (judge = none|internal|api|gpt|local)

```bash
npm run test:terminal:local                            # 터미널 리포트
npm run test:sheet:none:local                          # 시트 기록, judge 없음
npm run test:profile -- sheet:gpt:local --mode sync    # GPT judge
npm run test:profile -- sheet:api:stg --mode stream    # Gemini judge + 스트리밍(TTFT 측정)
npm run test:profile -- terminal:local -- -t "패턴"    # jest -t 필터
```

- 활성 케이스 파일 목록: `packages/e2e_regression/data/testcase_groups.ts`의 `CASE_GROUPS`
- 이어 돌리기: 같은 날 재실행하면 `.checkpoint.json` 기준으로 성공 케이스 skip, 실패만 재시도

### 프롬프트 수정 → 실시간 반영 (prompt_update)

```bash
cd packages/prompt_update && npm run dev               # 서버 기동 (8083)

# prompts/weather_answer.md 수정 후:
curl -X POST localhost:8083/promptUpdate -H 'Content-Type: application/json' -d '{}'
curl localhost:8083/status                             # 파일↔Redis 일치/llm_id 확인
```

### 프롬프트 자동 개선 (prompt_optimizer)

전제: 에이전트 서버 + prompt_update 서버(8083) 실행 중. **수동 테스트 런과 동시 실행 금지.**

```bash
npm run optimize:prompt -- --analyze-only              # 실패 수집 + flaky/진짜 실패 분류만
npm run optimize:prompt                                # 개선 루프 (기본 weather_entity.md, 3회)
npm run optimize:prompt -- --prompt weather_answer.md --iterations 5 --repeat 3 --temps 0,0.7
# 끝나면: git diff prompts/ 로 리뷰 후 커밋
```

개선안이 채택되면 변경 이유(LLM 분석)가 `prompts/CHANGELOG.md`에 자동 기록된다.
커밋 시 함께 담을 것 (커밋 메시지 규칙은 CLAUDE.md 참고).

### DB → Redis 동기화 (db_to_redis)

```bash
cd packages/db_to_redis && npm run dev                 # 서버 기동 (8082)
curl -X POST localhost:8082/dbToRedis -H 'Content-Type: application/json' -d '{"type": "prompt"}'
```

주의: 전체 동기화(`{}`)는 프롬프트/llm_id를 DB 값으로 되돌린다 → 이후 `POST localhost:8083/promptUpdate`로 복구.

### 모델 비교 watcher (model_payload_test)

```bash
npm run watch:weather:answer-compare                   # 터미널
REPORT_TO=sheet EVALUATE_WITH_GPT=1 npm run watch:weather:answer-compare   # 시트 + judge
```

end-to-end 감사: 회귀 러너에 `PUBLISH_AGENT_RESPONSE_STREAM=1`, watcher에 `JOIN_AGENT_RESPONSE_STREAM=1`.

### 캐시 프로브 (cache_probe)

```bash
npm run probe:cache
CACHE_PROBE_ROUNDS=0 CACHE_PROBE_STOP_ON_DIVERGENCE=1 npm run probe:cache   # 무한, 발견 시 중단
```

### 유틸 스크립트

```bash
npm run llm:list                                       # Redis config:llm:* 목록 (llm_id ↔ 모델 확인)
npm run llm:list -- --verbose                          # 전체 JSON 포함
tsx scripts/generate-entity-goldens.ts                 # entity golden 일괄 생성
                                                       # ⚠ testcase YAML을 직접 수정함. ENTITY_PARSER_PROMPT_FILE 지정 필요
npm run typecheck                                      # 전체 타입체크
```

---

## 환경변수 채우는 법

- **Google Sheets API**

    https://console.cloud.google.com/welcome/new 에서 프로젝트 생성 → Google Sheets API Enable
    → Credentials → Create Credentials → Service Account → Keys → Create private key (JSON)

    다운로드된 JSON에서 `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `private_key` → `GOOGLE_PRIVATE_KEY`.
    스프레드시트를 만들고 URL의 `https://docs.google.com/spreadsheets/d/<이 부분>/edit`을 `GOOGLE_SHEET_ID`에.
    해당 시트를 서비스 계정 이메일에 편집자로 공유해야 한다.
    결과 탭 이름은 프로필의 `sheetName`이 우선하며, 탭이 없으면 자동 생성된다.

- **Gemini**: https://ai.google.dev/gemini-api/docs/models 에서 모델 선택 → `AI_MODEL`, API 키 → `AI_API_KEY`

- **Ollama** (JUDGE_MODE=local용): https://ollama.com 설치 → `ollama pull gemma2:27b` → `LOCAL_AI_MODEL='gemma2:27b'`

- **시트 wrap 설정**: `packages/e2e_regression/config/settings/sheet.yaml`의 `wrapColumns`(기본 E,F,G,H)

각 패키지가 읽는 env의 전체 목록은 각 패키지 README의 환경변수 표 참고.

---

## AI 에이전트(Claude Code / Codex CLI)로 자동화하기

이 레포는 CLI 에이전트가 "테스트 돌리고 프롬프트 개선해줘" 한 마디로 전체 루프를
자율 수행할 수 있도록 세팅되어 있다:

| 파일 | 역할 |
|---|---|
| `CLAUDE.md` (= `AGENTS.md` 심링크) | 에이전트가 세션 시작 시 자동으로 읽는 운영 가이드. 핵심 사실, 명령어, 금지 규칙(동시 실행 금지, promptUpdate 필수, 백엔드 실패 구분, flaky 무시 등), 커밋 메시지 규칙 |
| `.claude/skills/improve-prompts/` | 프롬프트 개선 플레이북 스킬. Claude Code에서 `/improve-prompts`로 호출하거나 "프롬프트 개선해줘"라고 하면 자동 발동. 사전 확인 → 진단 → 개선 → 기록 → 보고 순서 강제 |
| `prompts/CHANGELOG.md` | 프롬프트 변경의 "왜/어떻게" 영구 기록 (최신이 위). prompt_optimizer가 개선안을 채택하면 자동 append, 수동 수정 시엔 같은 형식으로 직접 추가 |
| `.claude/settings.json` | 워크플로 명령 권한 allowlist (`npm run test/optimize/typecheck/llm:list`, `curl localhost:8083/8082`, 읽기 전용 `redis-cli`). 쓰기성 명령은 의도적으로 제외 — 물어보고 실행 |

### 프롬프트 변경 커밋 규칙

프롬프트 커밋에는 반드시 "왜"가 남아야 한다:

```
prompt(weather_entity): tuần này 표현의 weekPart 오추출 수정

- fail 5 → 2 (Weather_Week_Matrix 기준)
- 근거/분석: prompts/CHANGELOG.md 및 packages/prompt_optimizer/runs/<run디렉토리>
```

프롬프트 변경과 코드 변경은 커밋을 분리한다. 상세 규칙은 `CLAUDE.md` 참고.

---

## DEMO

테스트가 완료되면 슬랙에 메시지가 전송됩니다.
<img width="707" height="494" alt="slack report" src="https://github.com/user-attachments/assets/3f94935d-fb64-49e5-843f-00b3bb323794" />

구글 시트에는 케이스별 결과가 정리되어 Fail인 것만 검토하면 됩니다.
<img width="1210" height="540" alt="sheet report" src="https://github.com/user-attachments/assets/9a4ee244-7cf9-4697-a294-2c3b95c417a9" />

---

## Contributing

이 프로젝트는 더 효율적인 AI 에이전트 개발 문화를 지향합니다. 버그 리포트나 기능 제안은 언제나 환영합니다!
