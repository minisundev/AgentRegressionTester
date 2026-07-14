---
name: improve-prompts
description: 회귀 테스트를 돌려 실패를 분석하고 프롬프트를 개선·반영·기록하는 전체 워크플로. 사용자가 "프롬프트 개선해줘", "테스트 돌리고 고쳐줘", "실패 케이스 분석해줘"라고 할 때 사용.
---

# 프롬프트 개선 플레이북

전제 지식은 CLAUDE.md에 있다. 이 스킬은 순서만 정의한다.

## 0. 사전 확인 (건너뛰지 말 것)

```bash
curl -s localhost:8083/status          # prompt_update 서버. 실패하면: cd packages/prompt_update && npm run dev
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/aia-control/v1/agentChat   # 404 = 정상
ps aux | grep -c "[j]est"              # 0이 아니면 다른 테스트 런 진행 중 → 사용자에게 알리고 대기
git status --short prompts/           # 커밋 안 된 프롬프트 변경이 있으면 사용자에게 먼저 확인
```

`/status` 결과에서 `inSync: false`가 있으면 파일이 Redis보다 앞선 상태다.
개선 작업 전에 `POST /promptUpdate`로 일치시키고 시작한다.

## 1. 진단 — 무엇이 왜 실패하는가

```bash
npm run optimize:prompt -- --analyze-only
```

출력의 안정성 분석에서:
- `CONSISTENT-FAIL` + entity/answer diff → **프롬프트 개선 대상**
- `CONSISTENT-FAIL` + `Code:3xxxxx`만 → 백엔드 문제. 프롬프트로 못 고침. 사용자에게 보고만.
- `FLAKY` → 개선 근거로 쓰지 말 것. 많으면 인프라/동시성 문제를 의심.

진짜 실패가 0건이면 여기서 종료하고 그렇게 보고한다.

## 2. 개선 — 두 가지 경로

### A. 자동 루프 (기본)

```bash
npm run optimize:prompt                          # weather_entity.md
npm run optimize:prompt -- --prompt weather_answer.md
```

끝나면 터미널의 accepted/rejected 히스토리와
`packages/prompt_optimizer/runs/<최신>/iterN.analysis.md`를 읽고 결과를 요약한다.

### B. 직접 수정 (실패 원인이 명확할 때)

1. `spec/weather_agent_policy.md`에서 관련 정책을 확인한다.
2. `prompts/<대상>.md`를 최소 범위로 수정한다. `{language}` 같은 플레이스홀더 유지.
3. 반영: `curl -X POST localhost:8083/promptUpdate -d '{"file": "<파일명>"}'`
4. 재측정: `npm run optimize:prompt -- --analyze-only` (또는 좁힌 `test:profile -- terminal:local -- -t "그룹"`)
5. 개선 안 됐으면 `git checkout prompts/<파일>` 후 재반영하고 다른 가설로.

## 3. 기록 — 반드시 남길 것

- 자동 루프가 채택한 경우 `prompts/CHANGELOG.md`에 자동으로 항목이 추가된다.
  **직접 수정한 경우엔 직접 추가한다** (날짜, 파일, 실패 변화, 변경 이유, 검증 방법).
- 커밋 (프롬프트 변경만 담아서):

```
prompt(<파일명 축약>): <한 줄 요약 — 무엇을 왜>

- fail <before> → <after> (<측정 범위>)
- 상세: prompts/CHANGELOG.md
```

## 4. 종료 보고

사용자에게: 진짜 실패/flaky/백엔드 실패 개수, 채택된 변경과 그 이유(analysis 요약),
개선 폭(fail before→after), 커밋 여부, 남은 실패와 다음 제안.
