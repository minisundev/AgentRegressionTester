# prompt_optimizer

프롬프트 자동 개선 루프. 회귀 테스트(e2e_regression)로 실패 케이스를 수집하고,
LLM(Gemini)에게 현재 프롬프트 + 실패 목록 + 정책 문서를 주고 수정안을 받아
`prompt_update`로 Redis에 반영한 뒤 재측정한다. 개선되면 채택, 아니면 롤백. 반복.

## 전체 플로우

```
① 전체 baseline 측정 (현재 prompts/*.md를 Redis에 sync한 뒤 실행)
② 실패 케이스만 원본 yaml에서 추출 → optimizer_focus.yaml 생성
③ focus를 R회 반복 측정 (+선택: temperature별)
   → 매번 실패 = "진짜 실패" / 가끔 실패 = "flaky" 분류
④ LLM에 진짜 실패만 전달 → 프롬프트 수정안 생성
⑤ 수정안을 prompts/*.md에 쓰고 promptUpdate로 Redis 반영
⑥ focus R회 재측정 → 진짜 실패가 줄었을 때만
⑦ 전체 스위트 1회 회귀 게이트 → 전체 실패도 늘지 않아야 채택
⑧ 기각 시 best 프롬프트로 파일+Redis 롤백. ④~⑧을 N회 반복
```

핵심 설계:

- **flaky 필터링(③)**: 측정 노이즈로 프롬프트를 흔들지 않도록, 기준 온도에서 R회 전부
  실패한 케이스만 "프롬프트가 실제로 틀리는 것"으로 간주해 LLM에 전달한다.
- **이중 채택 게이트(⑥⑦)**: focus(빠름, 반복)에서 개선 + 전체(느림, 1회)에서 비회귀 —
  둘 다 통과해야 채택. 좁은 범위만 보고 채택했다가 다른 케이스를 깨뜨리는 것을 막는다.
- **temperature 프로브**: `--temps 0,0.7`을 주면 각 온도에서도 R회 측정해 온도 민감도
  매트릭스를 보여준다 (temp 0에서도 실패 = 로직 버그, 고온에서만 = 샘플링 노이즈).
  프로브가 끝나면 원래 temperature로 복원된다.

## 사전 조건

1. **에이전트 서버** 실행 중 — `CONTROL_BASE_URL` (local 프로필 = localhost:8080)
2. **prompt_update 서버** 실행 중 — `cd packages/prompt_update && npm run dev` (8083)
3. 루트 `.env`에 `AI_API_KEY` (수정안 생성용 Gemini 키)
4. 대상 프롬프트가 `prompts/manifest.yaml`에 등록되어 있을 것

## 실행 (레포 루트에서)

```bash
npm run optimize:prompt                          # 기본: weather_entity.md, 3회 시도, 3회 반복 측정
npm run optimize:prompt -- --analyze-only        # baseline + 안정성 분석만 (프롬프트 수정 없음)
npm run optimize:prompt -- --repeat 5            # 반복 측정 횟수
npm run optimize:prompt -- --temps 0,0.7         # 온도별 안정성 프로브 추가
npm run optimize:prompt -- --prompt weather_answer.md --iterations 5
npm run optimize:prompt -- --test-args "-t weather_week"   # baseline 범위 축소 (jest -t 필터)
```

기본값은 `config/optimizer.yaml`:

| 키 | 기본 | 설명 |
|---|---|---|
| `promptFile` | weather_entity.md | 개선 대상 (manifest 등록 필수) |
| `selector` | terminal:local | run-test-profile 선택자 |
| `testArgs` | [] | baseline 실행에 넘길 jest 인자 |
| `maxIterations` | 3 | 개선 시도 횟수 |
| `repeats` | 3 | focus 반복 측정 횟수 |
| `probeTemps` | [] | 추가 온도 프로브 목록 |
| `promptUpdateUrl` | http://localhost:8083 | prompt_update 서버 |
| `model` / `temperature` | gemini-3-flash-preview / 0.3 | 수정안 생성 LLM |

## 안전장치

- **수정안 검증**: `{language}` 같은 런타임 플레이스홀더 유실, 길이 급변(원본의 0.5~2배 밖)이면
  자동 기각 후 1회 재시도. LLM에는 "최소 수정, 구조 유지" 지침이 들어간다.
- **인프라 에러 감지**: 실패의 절반 이상이 네트워크/5xx면 즉시 중단 — 에이전트 서버가 죽었는데
  그 노이즈로 프롬프트를 "개선"하는 것을 방지.
- **진짜 실패 0건이면 종료**: 전부 flaky면 프롬프트 수정으로 고칠 문제가 아니므로 손대지 않는다.
- **체크포인트 격리**: 실행마다 `runs/` 아래 전용 체크포인트를 쓰므로 수동 테스트의
  `.checkpoint.json`을 건드리지 않는다.
- **종료 보장**: 어떤 경로로 끝나든(에러 포함) 파일과 Redis를 best 프롬프트 상태로 맞춘다.

## 동시 실행 주의

체크포인트는 격리했지만 **에이전트 서버와 Redis 프롬프트는 공유 자원**이다.
옵티마이저는 측정 중에 프롬프트를 갈아끼우므로, 수동 테스트 런과 동시에 돌리면
**양쪽 결과가 모두 오염**된다. 하나씩 돌릴 것.

## 산출물 — `runs/<timestamp>_<prompt>/`

| 파일 | 내용 |
|---|---|
| `baseline.md` | 시작 시점 프롬프트 (수동 복구용 백업) |
| `baseline.results.json` | 전체 baseline 측정치 (성공/실패 전체 행) |
| `stability.json` | 케이스별 반복/온도 실패 매트릭스 |
| `iterN.md` | N번째 수정안 전문 |
| `iterN.analysis.md` | LLM의 실패 패턴 분석과 수정 근거 |
| `iterN.t*.r*.results.json` | focus 반복 측정치 |
| `iterN.full.results.json` | 회귀 게이트 측정치 |

## 끝난 뒤

best 프롬프트가 `prompts/*.md`와 Redis에 남는다.

```bash
git diff prompts/                 # 리뷰
git add prompts/ && git commit    # 채택
# 마음에 안 들면:
git checkout prompts/ && curl -X POST localhost:8083/promptUpdate -d '{}'
```
