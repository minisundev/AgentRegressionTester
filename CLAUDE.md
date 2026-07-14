# Agent Regression Tester — 에이전트 운영 가이드

날씨 LLM 에이전트의 회귀 테스트 + 프롬프트 개선 파이프라인. 사람이 "테스트 돌리고 프롬프트 개선해줘"라고
하면 이 문서와 `.claude/skills/improve-prompts`의 플레이북을 따른다.

## 핵심 사실

- **프롬프트의 소스 오브 트루스는 `prompts/*.md`** (git 관리). Redis는 반영 대상일 뿐이다.
  파일 수정 후 `POST localhost:8083/promptUpdate`를 호출해야 에이전트에 반영된다.
- 파일↔키 매핑과 `llm_id`(모델 선택)는 `prompts/manifest.yaml`에 선언되어 있다.
- 에이전트의 기대 동작 스펙은 `spec/weather_agent_policy.md`. 프롬프트를 고치기 전에 반드시 읽을 것.
- 테스트케이스는 `packages/e2e_regression/config/testcases/*.yaml`,
  활성 목록은 `packages/e2e_regression/data/testcase_groups.ts`의 `CASE_GROUPS`.
- 각 패키지의 상세 동작은 `packages/*/README.md`에 있다.

## 자주 쓰는 명령

```bash
# 서버 상태 확인 (둘 다 살아있어야 테스트/개선 가능)
curl -s localhost:8083/status                  # prompt_update — 파일↔Redis 일치, llm_id 확인
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/aia-control/v1/agentChat  # 404면 정상(살아있음)

# prompt_update 서버 기동 (안 떠 있을 때)
cd packages/prompt_update && npm run dev

# 회귀 테스트
npm run test:terminal:local                            # 터미널 리포트
npm run test:profile -- terminal:local -- -t "패턴"    # 특정 그룹만

# 프롬프트 자동 개선
npm run optimize:prompt -- --analyze-only              # 실패 수집 + 진짜실패/flaky 분류 (수정 없음)
npm run optimize:prompt                                # 개선 루프 (기본 weather_entity.md)
npm run optimize:prompt -- --prompt weather_answer.md --iterations 5

# 프롬프트 수동 반영 / 확인
curl -X POST localhost:8083/promptUpdate -H 'Content-Type: application/json' -d '{}'
npm run llm:list                                       # llm_id ↔ 모델 매핑 확인

npm run typecheck
```

## 반드시 지킬 것

1. **테스트 런 동시 실행 금지.** 옵티마이저와 수동 테스트, 혹은 두 테스트 런을 동시에 돌리면
   에이전트 서버/Redis 프롬프트가 공유라 양쪽 결과가 다 오염된다. 시작 전에
   `ps aux | grep jest`로 돌고 있는 런이 없는지 확인.
2. **프롬프트 파일을 수정했으면 반드시 promptUpdate 호출.** 파일만 고치면 반영 안 된다.
   반영 후 `GET /status`로 `inSync: true` 확인.
3. **`Code:344303` 류의 resultCode 실패는 백엔드 문제**라 프롬프트로 못 고친다.
   entity golden diff(`value mismatch` 등)가 있는 실패만 프롬프트 개선 대상.
4. **flaky를 근거로 프롬프트를 고치지 말 것.** 같은 케이스를 반복 실행해서 매번 실패할 때만
   진짜 실패다 (`--analyze-only`가 자동으로 분류해준다).
5. **db_to_redis 전체 동기화(`POST :8082/dbToRedis {}`)는 프롬프트/llm_id를 DB 값으로 되돌린다.**
   실행했다면 직후에 `POST :8083/promptUpdate`로 복구.
6. `.env`, 시트 키, Slack webhook은 절대 커밋 금지.

## 프롬프트 변경의 기록 규칙

프롬프트(`prompts/*.md`)를 바꿔서 커밋할 때는 **왜 바꿨는지가 반드시 남아야 한다**:

- `prompts/CHANGELOG.md`에 항목 추가 — 옵티마이저가 개선안을 채택하면 자동으로 추가된다.
  수동으로 고친 경우엔 직접 같은 형식(날짜, 파일, 실패 변화, 변경 이유)으로 추가할 것.
- 커밋 메시지 형식:

  ```
  prompt(weather_entity): tuần này 표현의 weekPart 오추출 수정

  - fail 5 → 2 (Weather_Week_Matrix 기준)
  - 근거/분석: prompts/CHANGELOG.md 및 packages/prompt_optimizer/runs/<run디렉토리>
  ```

- 프롬프트 변경과 코드 변경을 한 커밋에 섞지 말 것.
- 커밋 전에 `git diff prompts/`로 의도한 변경만 있는지 확인. 롤백은
  `git checkout prompts/ && curl -X POST localhost:8083/promptUpdate -d '{}'`.

## 리포트가 쌓이는 곳

- `packages/prompt_optimizer/runs/<타임스탬프>_<프롬프트>/` (gitignore, 로컬 실험 로그)
  - `baseline.md` 원본 / `iterN.md` 수정안 / `iterN.analysis.md` LLM의 변경 이유
  - `stability.json` 케이스별 반복×온도 실패 매트릭스 / `*.results.json` 측정치
- `prompts/CHANGELOG.md` (git 커밋됨, 영구 기록) — 채택된 변경의 왜/어떻게
- Google Sheet / Slack — 회귀 테스트 리포트 (REPORT_TO=sheet일 때)
