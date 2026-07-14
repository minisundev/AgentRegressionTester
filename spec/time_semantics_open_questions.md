# 시간 표현 엔티티 해석 — 확인 결과 (2026-07-14 확정)

`tới` 계열 표현의 anchor 기준 확인 문서. **모든 항목 결정 완료** — 확정 정책은
`spec/weather_agent_policy.md` #4-1에 반영됨. 이 문서는 결정 기록용.

## 결정된 케이스

| # | 발화 | 확정 해석 (엔티티) | 근거 |
|---|---|---|---|
| 1 | `24 giờ tới` (bare) | **duration** — `delta=24, deltaUnit=hour, rangeRelation=null` (지금부터 24시간) | 기상 보도 관용구. bare여도 시간 단위 `tới`는 rolling window |
| 2 | `3 ngày tới` | `delta=3, deltaUnit=day, rangeRelation=after` (내일부터 3일) | 고객사 확정 (`trong 2 ngày tới` = 내일–모레). 리졸버가 after로 하루 밀어줌 |
| 3 | `trong vòng 2 ngày tới` | `delta=2, deltaUnit=day, rangeRelation=after` (내일부터) | 일 단위는 trong vòng이 붙어도 밀기 유지 |
| 4 | `tuần tới` | `relativeWeeks=1` (다음 월요일부터 7일) | boundary 기준 확정 |
| 5 | `hôm nay và ngày mai` | `rangeRelation=from` (오늘부터 2일) | 오늘 명시적 포함 |

- `trong vòng 4 giờ tới` → `delta=4, deltaUnit=hour, rangeRelation=null` (지금 포함 rolling).
  "지금 포함" ≠ "현재 hour bucket 포함" — hourlyCard 정시(3시간 단위 올림) 정렬은 데이터 문제.
- 단일 시점 오프셋은 `N giờ nữa` / `sau N giờ` / `in N hours` → `relativeHours=N`.

## 기타 컨벤션 — 결정 완료

1. **시각 범위의 meridiem**: 마커(sáng/trưa/am/pm)나 24h형이 있으면 당연히 적용 (엔티티
   프롬프트 #11 룰 그대로). 골든만 정규화함 (9건 am, 24h형 2건은 원래 맞았음).
2. **`các ngày trong tuần (này/sau)`**: **whole로 통일**. 프롬프트 #17에도 반영.
3. **localizedLocation**: 헤더 언어(accept-language) 따라감 — vi면 성조 복원(`Vũng Tàu`),
   지역명(`Miền Trung`)은 디폴트 도시 치환 없이 그대로. 프롬프트 #1-2 룰대로 골든 정규화함.
4. **한국어 "낮"**: 프롬프트에 한국어 규칙 추가하지 않음 (한국어는 프롬프트에서 제외 방침).

## 개편 방향 메모 (백엔드/스키마)

엔티티에 `granularity`(hour/day/week) + `anchor`(now / next_boundary) 분리, 최종
`[start_ts, end_ts]` 정규화 구조 검토. 현재는 rangeRelation(after=next boundary,
null/from=now-anchored)으로 근사하며, 밀기 실행은 aia-service 리졸버(timeRange) 담당.

## 부수 발견 (2026-07-14)

- `fat_r2_precipitation.yaml`에 id 125–164가 영어/베트남어 블록으로 중복돼 있었음 →
  영어 블록을 225–264로 리넘버링 (중복 id는 체크포인트 키 충돌로 케이스가 조용히 스킵됨).
