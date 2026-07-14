# prompt_update

로컬 `prompts/*.md` 파일을 Redis `llm_prompt:*` 키에 바로 반영하는 로컬 개발 도구.
`db_to_redis`의 prompt 동기화(DB → Redis)를 파일 → Redis 방식으로 대체한다.

파일 고치고 API 한 번 호출하면 프롬프트가 실시간 반영된다.
`llm_id`는 `prompts/manifest.yaml`에 고정되므로, DB 동기화가 llm_id를 GPT로 되돌려도 다시 sync 하면 복구된다.

## 사용 방법

### 1. `.env` 완성하기 (`.env.example` 참고)

### 2. 매핑 확인 — `prompts/manifest.yaml`

```yaml
defaults:
  llm_id: "8"          # sync 때마다 강제 적용

prompts:
  - file: weather_answer.md
    promptType: ANSWER
    targets:
      - Weather:CheckDailyForecast
      - Weather:CheckWeeklyForecast
      - Weather:CheckHourlyForecast
```

### 3. 서버 띄우기

```
npm install
npm run dev
```

### 4. 호출하기

```bash
# 전체 반영
curl -X POST http://localhost:8083/promptUpdate -H 'Content-Type: application/json' -d '{}'

# 특정 파일만
curl -X POST http://localhost:8083/promptUpdate -H 'Content-Type: application/json' \
  -d '{"file": "weather_answer.md"}'

# 미리보기 (Redis에 안 씀)
curl -X POST http://localhost:8083/promptUpdate -H 'Content-Type: application/json' \
  -d '{"dryRun": true}'

# 현재 상태 조회 (llm_id 확인, 파일↔Redis 일치 여부)
curl http://localhost:8083/status
```

Swagger: http://localhost:8083/docs

### watch 모드

`.env`에 `WATCH=true`를 켜면 API 호출 없이도 md 파일 저장 즉시 자동 반영된다.

## 동작 방식

각 target(`Main:Sub`)에 대해:

- `llm_prompt:{Main}:{Sub}:{TYPE}` — `{llm_id, prompt_text, temperature, version}` JSON
  - `prompt_text`: md 파일 내용 그대로
  - `llm_id`: manifest 값 (entry > defaults > 기존 Redis 값 순)
  - `temperature`, `version`: 기존 Redis 값 보존
- `prompt:{type}:{sha256(main:sub)}` — 레거시 키도 db_to_redis와 동일 규칙으로 함께 갱신

기존 payload와 완전히 같으면 쓰지 않는다(`unchanged`).
