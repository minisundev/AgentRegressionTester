# db_to_redis

PostgreSQL(에이전트 CMS DB)에 있는 캐시/프롬프트/LLM 설정을 Redis로 동기화하는 로컬 개발 도구.
에이전트 서버(ds-aia-control)는 Redis만 바라보므로, DB를 수정한 뒤 이 서버를 호출해야 변경이 반영된다.

> **프롬프트 작업은 이제 [prompt_update](../prompt_update)를 쓰는 걸 권장.**
> db_to_redis의 prompt 동기화는 DB 원본 기준이라, 로컬에서 실험 중인 프롬프트와 `llm_id`를
> DB 값으로 되돌려버린다 (예: Gemini로 바꿔둔 llm_id가 GPT로 돌아감).
> db_to_redis 전체 동기화를 돌린 뒤에는 `POST localhost:8083/promptUpdate`로 복구하면 된다.

## 실행

```bash
cd packages/db_to_redis
npm install
# .env 작성 (.env.example 참고 — PG_*, REDIS_*, PORT)
npm run dev        # build + start, 기본 포트 8082 (.env의 PORT)
```

- Swagger: http://localhost:8082/docs

## API

### `POST /dbToRedis`

| body | 동작 |
|---|---|
| `{}` (생략) | **전체 동기화**: cache + prompt + llm 모두. 동기화 후 DB에 없는 기존 Redis 키는 삭제 |
| `{"type": "cache"}` | 캐시만. `key`에 `utter_text` 값을 주면 해당 발화만 |
| `{"type": "prompt"}` | 프롬프트만. `key`에 `MainIntent:SubIntent`를 주면 해당 인텐트만 |
| `{"type": "llm"}` | LLM 설정만. `key`에 `llm_id`를 주면 해당 모델만 |

응답: `{"cacheCount": N, "promptCount": N, "llmCount": N}` (동기화된 행 수)

```bash
curl -X POST http://localhost:8082/dbToRedis -H 'Content-Type: application/json' -d '{"type": "prompt"}'
```

## 데이터 흐름 (PG → Redis)

### 1. cache — `public.cache` 테이블

`status_cd='ACTIVE'`이고 유효기간(`effective_from/to`) 내인 행만.

```
utter:<utter_hash>  →  행 전체 JSON (utter_text, response_text, main/sub intent, entity, agent_code …)
```

### 2. prompt — `agent_cms.agent_prompt` 테이블

`status_cd='ACTIVE'` 행만. **키를 두 벌** 쓴다 (신/구 형식 공존):

```
# 신형식: 에이전트가 읽는 키
llm_prompt:<MainIntent>:<SubIntent>:<PROMPT_TYPE>
  → {"llm_id": "8", "prompt_text": "...", "temperature": 0, "version": "..."}

# 구형식: 하위 호환
prompt:<prompt_type소문자>:<sha256(normalize("main:sub"))>
  → prompt_text 원문 문자열
```

`normalize` = 공백 정리 + 소문자화 후 sha256. PROMPT_TYPE은 `ANSWER`/`ENTITY`/`CLASSIFY`/`SUGGESTION` 등.

### 3. llm — `agent_cms.llm_management` 테이블

```
config:llm:<llm_id>
  → {"url": endpoint_url, "group": "GPT4|GEMMA|CLAUDE|GEMINI…", "version": model_version,
     "auth_key": <.env의 LLM_*_API_KEY에서 group별 매핑>, "llm_deploy": ...}
```

`auth_key`는 DB가 아니라 **이 서버의 .env**에서 온다:
`GPT4 → LLM_GPT_4O_API_KEY`, `GEMMA → LLM_GEMMA_API_KEY`, `CLAUDE → LLM_CLAUDE_API_KEY`.
매핑에 없는 group(GEMINI 등)은 `auth_key: null`로 들어가므로 필요하면 직접 채워야 한다.

## 환경변수 (.env)

| 변수 | 설명 |
|---|---|
| `PORT` | 서버 포트 (기본 8081, 관례상 8082 사용) |
| `PG_HOST` / `PG_PORT` / `PG_DATABASE` / `PG_USER` / `PG_PASSWORD` | 에이전트 CMS PostgreSQL |
| `REDIS_ENDPOINT` / `REDIS_PORT` / `REDIS_PASSWD` / `REDIS_SSL` | 에이전트가 쓰는 Redis |
| `LLM_GPT_4O_API_KEY` / `LLM_GEMMA_API_KEY` / `LLM_CLAUDE_API_KEY` | llm 동기화 시 `config:llm:*`의 auth_key로 주입 |

## 주의

- 전체 동기화(`{}`)는 **삭제 포함**: DB에 없는 `utter:*`, `prompt:*`, `llm_prompt:*`, `config:llm:*` 키가 지워진다.
  로컬에서 수동으로 만든 Redis 키가 있다면 날아가니 주의.
- prompt 동기화는 로컬 프롬프트 실험 상태를 덮어쓴다 → 이후 `prompt_update`로 재동기화할 것.
