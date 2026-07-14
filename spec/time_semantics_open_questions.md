# 시간 표현 엔티티 해석 — 베트남팀 확인 요청 케이스

작성: 2026-07-14. `tới` 계열 표현의 anchor 기준을 확정하기 위한 확인 문서.
결정된 원칙(2026-07-14): **`after`(한 칸 밀기)는 단어 `tới`가 아니라 의미 구조에 매핑한다.**

- 일/주 단위 예보 기간 표현 → anchor: next calendar unit (오늘 제외, 내일부터)
- 시간 단위 rolling window → anchor: current instant (지금 포함)

## 확인 요청 케이스

| # | 발화 | 현재 해석 (엔티티) | 확인할 것 |
|---|---|---|---|
| 1 | `24 giờ tới` (bare, trong 없음) | 단일 시점 오프셋 `relativeHours=24` | 기상 보도 관용구로는 "지금부터 24시간" duration이 일반적. bare여도 duration으로 볼지? |
| 2 | `3 ngày tới` | `delta=3, deltaUnit=day, rangeRelation=after` (내일부터 3일) | 내일부터 3일 맞는지 (baochinhphu 용례: 5/15 기사에서 `trong 2 ngày tới` = 16–17/5) |
| 3 | `trong vòng 2 ngày tới` | `delta=2, deltaUnit=day, rangeRelation=after` (내일부터) | 마감/윈도우 표현으로 "지금부터 48시간"으로 읽히는 용례도 있음. 일 단위도 `trong vòng`이 붙으면 now-anchor인지? |
| 4 | `tuần tới` | `relativeWeeks=1` (다음 월요일부터 7일) | 주 단위는 boundary 기준 확정 — 이견 없는지 확인만 |
| 5 | `hôm nay và ngày mai` | 오늘 포함 명시형 → `rangeRelation=from` (오늘부터 2일) | 오늘 포함 명시 시 from 처리 맞는지 |

## 확정된 케이스 (참고)

- `trong vòng 4 giờ tới` → `delta=4, deltaUnit=hour, rangeRelation=null` (지금 포함 rolling 4시간). VOV 용례: 08:10 관측 직후 "trong vòng 4 giờ tới" = 현재 시점부터의 구간.
  - 단, "지금 포함" ≠ "현재 hour bucket을 카드에 포함". hourlyCard가 정시(3시간 단위 올림)로 정렬되는 것은 언어 해석이 아니라 데이터 정렬 문제.
- `10 giờ tới độ ẩm...` (bare) → `relativeHours=10` 단일 시점 (1번 케이스와 함께 재확인 필요)

## 기타 컨벤션 확인 필요 (엔티티 골든 정규화 대기 중)

1. **시각 범위의 meridiem**: `từ 6h đến 11h sáng` 같은 범위에서 meridiem을 시작 시각 기준으로 설정할지, 범위에서는 항상 null로 둘지. (골든이 파일마다 갈림, 11건)
2. **`các ngày trong tuần (này/sau)`**: whole / weekdays / null 중 무엇인지. (골든 whole 6건 vs null 7건)
3. **localizedLocation 표기**: 무성조 입력("Vung Tau") 시 성조 복원 여부; 지역명("Miền Trung") 처리 — 유지 vs 디폴트 도시 치환. (골든 충돌)
4. **한국어 "낮"**: timeOfDay 매핑 (noon? afternoon? null?)

향후 개편 방향 메모: 엔티티에 `granularity`(hour/day/week) + `anchor`(now / next_boundary)를
분리하고 최종적으로 `[start_ts, end_ts]`로 정규화하면 1·3번 같은 케이스가 자연스럽게 분리됨.
현재는 rangeRelation(after=next boundary, null/from=now-anchored)으로 근사 중.
