# prompts/ CHANGELOG

## 2026-07-14 — weather_entity.md: 시간 단위 duration의 after 제거 (직접 수정)

- 변경: #8-5를 단위별로 분리 — 일/주 단위 duration(`trong N ngày/tuần tới`, `next N days`)은
  기존대로 `rangeRelation=after`(내일부터), **시간 단위 duration(`trong (vòng) N giờ tới`,
  `next N hours`)은 현재 시각 포함 rolling window로 `delta=N, deltaUnit=hour, rangeRelation=null`**.
  #19-17 검증 규칙도 동일하게 수정.
- 이유: `tới`를 일괄 `after`로 매핑하면 시간 표현이 하루/한 칸 밀림(CheckWeeklyForecast에서
  "10 giờ tới"가 하루 밀린 버그 계열). 날(ngày)은 이산 달력 단위라 "다가오는 날"=내일부터가
  맞지만, giờ는 연속 지속시간이라 지금 포함이 맞음 (VOV·baochinhphu 용례 근거,
  spec/time_semantics_open_questions.md 참고).
- 골든 동기 수정: rangeTypeTester:9, fat_weather_vi:206, ai_ftc_1001_weather:23 —
  `relativeHours=0` → `delta=N/deltaUnit=hour/rangeRelation=null`
  (#19-3 sentinel 금지와도 일치).
- 검증: prompt_update 동기화 후 라이브 스팟체크 —
  "Dự báo thời tiết Đà Nẵng trong vòng 4 giờ tới" → `delta=4, hour, rel=null, relH=null`,
  응답 "Nhiệt độ trung bình trong 4 giờ tới..." (지금부터 4시간) 확인.

## 2026-07-14 — weather_answer.md: 어순·표현 규칙 추가 (직접 수정)

- 변경: #5에 위치·시간 후치(문장 끝) 규칙 + BAD/GOOD 예시, `là cao/là thấp` 금지,
  `rất` 강화 금지, "khả năng mưa là có thể xảy ra" 금지 추가. #6-2-1-1에 요약 응답은
  측정값으로 시작(모호한 오프너 금지) 추가.
- 이유: GPT judge 룰 F1이 68/69행 실패(위치·시간 전치), F2/B계열 다수 실패.
- 검증: 시트 local_260714_entity_prompt_eval 기준 적용 전 F1 82%/C4 29%/B2 26% →
  적용 후 F1 45%/C4 14%/B2 14% (행당 비율, 구성 그룹 차이 있음).

## 2026-07-14 — weather_entity.md: 엔티티 추출 보강 (직접 수정)

- 변경: #3 weatherMetric — "<time>'s weather" 가능형/시간대 수식 발화도 `all` 예시 추가.
  #11-2 — 맨 시각 범위("từ 6 giờ đến 12 giờ")에서 meridiem 추측 금지 예시.
  #12-4 — 영어 "tonight"은 "tối nay"(eve)로 번역하지 말고 원문 기준 night 매핑.
  #8-6 — "20 days from now" 단일 오프셋 예시.
- 이유: 회귀 런에서 metric null 누락(7건+), tonight→eve 오추출, 20일 오프셋을
  delta/from으로 오추출.
- 검증: 라이브 스팟체크 3건 통과 (metric=all, timeOfDay=night, relativeDays=20).
