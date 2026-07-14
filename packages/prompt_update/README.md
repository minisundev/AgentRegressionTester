# prompt_update

로컬 `prompts/*.md` 파일을 **소스 오브 트루스**로 삼아 Redis `llm_prompt:*` 키에 직접 반영하는 로컬 개발 도구.
`db_to_redis`의 prompt 동기화(DB → Redis)를 파일 → Redis 방식으로 대체한다.

**워크플로**: 프롬프트 md 파일 수정 → API 한 번 호출 → 에이전트에 즉시 반영.
프롬프트가 git으로 관리되므로 diff 리뷰·롤백·이력 추적이 공짜로 따라온다.

## 왜 만들었나

- DB에서 프롬프트를 관리하면 수정 → DB 반영 → db_to_redis 호출의 루프가 느리고, 버전 관리가 안 된다.
- db_to_redis 전체 동기화가 돌 때마다 `llm_id`가 DB 값(GPT)으로 되돌아가는 문제가 있었다.
  이 도구는 `llm_id`를 `prompts/manifest.yaml`에 고정하므로, 언제든 한 번 호출로 원하는 모델로 복구된다.

## 실행

```bash
cd packages/prompt_update
npm install
# .env 작성 (.env.example 참고 — REDIS_*, PORT=8083)
npm run dev
```

- Swagger: http://localhost:8083/docs

## 매핑 선언 — `prompts/manifest.yaml` (레포 루트)

```yaml
defaults:
  llm_id: "8"              # 미지정 entry에 적용되는 기본 모델

prompts:
  - file: weather_answer.md
    promptType: ANSWER
    llm_id: "8"            # sync 때마다 강제 적용 (entry > defaults > 기존 Redis 값)
    targets:               # 이 파일 하나가 여러 인텐트 키로 팬아웃됨
      - Weather:CheckDailyForecast
      - Weather:CheckWeeklyForecast
      - Weather:CheckHourlyForecast

  - file: weather_entity.md
    promptType: ENTITY
    llm_id: "3"
    targets: [ ... ]
```

- `file`: `prompts/` 밑의 md 파일명. 파일 내용 전체가 `prompt_text`가 된다.
- `promptType`: `ANSWER` / `ENTITY` / `CLASSIFY` / `SUGGESTION` 등 Redis 키의 마지막 세그먼트.
- `targets`: `MainIntent:SubIntent` 목록. 각 target마다 `llm_prompt:{Main}:{Sub}:{TYPE}` 키가 갱신된다.
- `llm_id`: `config:llm:<id>` 참조. 현재 매핑은 `npm run llm:list`(레포 루트)로 확인.
- `temperature`(entry/defaults, 선택): 미지정 시 기존 Redis 값 보존.

## API

### `POST /promptUpdate`

```bash
# 전체 반영
curl -X POST localhost:8083/promptUpdate -H 'Content-Type: application/json' -d '{}'

# 특정 파일만
curl -X POST localhost:8083/promptUpdate -H 'Content-Type: application/json' -d '{"file": "weather_answer.md"}'

# 미리보기 (Redis에 안 씀)
curl -X POST localhost:8083/promptUpdate -H 'Content-Type: application/json' -d '{"dryRun": true}'

# temperature 오버라이드 (prompt_optimizer의 온도 프로브가 사용)
curl -X POST localhost:8083/promptUpdate -H 'Content-Type: application/json' -d '{"file": "weather_entity.md", "temperature": 0.7}'
```

응답의 각 결과 행: `{key, file, action(created|updated|unchanged), llm_id_before, llm_id, chars}`.
기존 payload와 완전히 같으면 쓰지 않고 `unchanged`.

### `GET /status`

manifest의 모든 target 키에 대해 현재 상태를 보여준다:

```json
{"key": "llm_prompt:Weather:CheckDailyForecast:ANSWER", "file": "weather_answer.md",
 "exists": true, "llm_id": "8", "temperature": 0, "inSync": true}
```

- `inSync: false` = 로컬 파일이 Redis보다 앞서 있음 (반영 필요)
- `llm_id`가 의도와 다르면 db_to_redis가 덮어쓴 것 → `POST /promptUpdate`로 복구

## 동작 방식

각 target에 대해 다음 두 키를 트랜잭션(MULTI)으로 갱신한다:

```
llm_prompt:{Main}:{Sub}:{TYPE}
  → {"llm_id": manifest값, "prompt_text": 파일 내용, "temperature": 보존/오버라이드, "version": 보존}

prompt:{type소문자}:{sha256(normalize("main:sub"))}     # db_to_redis와 동일한 레거시 키
  → 파일 내용 원문
```

- `llm_id` 우선순위: entry > defaults > 기존 Redis 값
- `temperature` 우선순위: API 오버라이드 > entry > defaults > 기존 Redis 값 > 0
- `version`: 기존 값 보존 (없으면 `"local"`)

## watch 모드

`.env`에 `WATCH=true`를 켜면 `prompts/` 디렉토리를 감시해서 md 파일이나 manifest.yaml 저장 즉시
자동 반영한다 (API 호출 불필요, 300ms 디바운스).

## 환경변수 (.env)

| 변수 | 기본 | 설명 |
|---|---|---|
| `PORT` | 8083 | 서버 포트 |
| `PROMPTS_DIR` | `../../prompts` | 프롬프트 디렉토리 위치 오버라이드 |
| `WATCH` | false | 파일 저장 시 자동 sync |
| `REDIS_ENDPOINT` / `REDIS_PORT` / `REDIS_PASSWD` / `REDIS_SSL` | — | 에이전트가 쓰는 Redis |
