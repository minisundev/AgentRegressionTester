날씨 기획 및 정책 설명

날씨 Agent는 request에 들어오는 subIntent에 따라서 동작함

CheckHourlyForecast intent → hourly 예보(weekly가 포함되지 않은 모든 시간 발화
CheckDailyForecast intent → today 예보(현재, 오늘 daily 발화
intent에 따라 today만 응답함, now고 뭐고 걍 today응답 나감
CheckWeeklyForecast intent → weekly 예보(내일부터 daily 예보)
시간을 물어봤어도 intent에 따라 잘라서 daily data로만 응답

Intent 분류 기준

hour, timeOfDay 등 시간이 포함된 발화일 시
현재부터 23:59분까지 → CheckHourlyForecast intent
현재부터 24시간 후부터 → CheckWeeklyForecast intent
now, today 발화
CheckDailyForecast intent
2)를 제외하고 현재부터 24시간 후가 포함된 발화
CheckWeeklyForecast intent

날씨 카드 데이터

CheckDailyForecast → todayCard

todayCard 출력 데이터

강수확률: 가장 인접한 hourly item의 강수확률
지금 온도, 오늘의 최고 온도, 오늘의 최저 온도
CheckWeeklyForecast → todayCard, weeklyCard

weeklyCard 출력 데이터 (사용자 발화 시점에 따라 달라짐)

일 단위 동작

특정 일자 요청 (17일 날씨, 금요일 날씨, 내일 날씨)
특정 일자부터 7일
주 단위 동작 (주말, 주중, 한 주 통으로)

이번주: 내일부터 7일
이번 주 주말
이번 주 주중
이번 주
다음주: 다음 월요일부터 7일
다음 주 주말
다음 주 주중
다음 주
다다음주: 다다음 월요일부터 7일
다다음 주 주말
다다음 주 주중
다다음 주
CheckHourlyForecast → todayCard, hourlyCard

hourlyCard 출력 데이터

사용자가 요청한 시간에 관계없이 현지 기준의 현재시간부터 3시간 단위로 올림한 시각부터 시작하여 3시간 단위로 7개 출력
날씨 timeOfDay 시간 매핑

Time period :

Dawn: 06:00~08:59

Morning: 09:00~11:59

Noon: 12:00~13:59

Afternoon: 14:00~17:59

Evening: 18:00~20:59

Night: 21:00~05:59

가장 가까운 다음 시간 예보 정책

9시 알려줘 → 오전 9시(오늘 오전 9시 안 지남) → 오후 9시(오늘 오후 9시 안 지남) → 내일 오전 9시(내일 오전 9시 안 지남) 으로 fallback
아침 알려줘 → 기간 범위의 경우에 끝시간이 지난 경우만 내일로 fallback, 안 그러면 5로 중간에 잘리는 시간 예보 정책
중간에 잘리는 시간 예보 정책

범위로 요청되었고 앞부분/뒷부분이 예보가능한 범위에서 잘리는 경우 가능한 부분만 예보함
멀티턴 정책

지금 발화에 다음 사항이 빠져있고, 이전 발화에 존재한다면

시간(오늘/내일/다음주/2시/3시간 뒤)
지역(하노이, 서울, 도쿄)
metric(전체, air quality, humidity, precipitation)
이 유지됨

[지역 전이]

turn 1) 호치민 날씨 알려줘 → 호치민 예보

turn 2) 날씨 알려줘 → 호치민 예보

[metric 전이]

CASE 1) metric 전이 초기화

metric 전이가 초기화되는 경우 1 - general한 날씨를 물어봤을 때

turn 1) 습도 알려줘 → 하노이 습도 예보

turn 2) 호치민 날씨 알려줘 → 호치민 제너럴한 날씨 예보, 카드 default metric airQuality

metric 전이가 초기화되는 경우 2 - 온도를 물어봤을 때

turn 1) 습도 알려줘 → 하노이 습도 예보

turn 2) 호치민 온도 알려줘 → 호치민 제너럴한 날씨 예보, 카드 default metric airQuality

CASE 2) metric 전이 이어짐 (CASE 1에 해당하지 않는 모든 경우)

turn 1) 습도 알려줘 → 하노이 습도 예보

turn 2) 호치민은? → 호치민 습도 예보

[시간 전이]

turn 1) 호치민 다음주 날씨 알려줘 → 호치민 다음주 예보

turn 2) 하노이 날씨 알려줘 → 하노이 다음주 예보

테스트를 위한 추가 정보

동일한 발화 케이스지만, intent 분류가 다르게 되는 경우가 굉장히 많이 발생하고 있습니다

에이전트는 intent에 따라서 동작하게 되어 같은 질문에 대한 카드와 대답이라도 Intent에 따라 달라질 수 있습니다

intent를 확인해 주시고 intent별로 동작했는지 확인 부탁드립니다

tell me tomorrow evening’s weather
CheckWeeklyForecast로 나올 때도 있고,
CheckHourlyForecast로 나올 때도 있음
air quality 관련 데이터 설명

fine dust, ultra fine dust, AQI(Air Quality Index)는 각각 모두 다른 값
미세먼지 나쁨, 초미세먼지 나쁨이어도 공기질은 보통일수도 있음
공기질에는 미세먼지 외의 다른 오염물질 예보도 모두 포함되기 때문임
Weather Planning and Policy Guide

1. Weather Agent Behavior by subIntent

The Weather Agent works based on the subIntent included in the request.

1.1 CheckHourlyForecast

Returns an hourly forecast.

This intent is used for time-based requests that are not classified as weekly requests.

1.2 CheckDailyForecast

Returns today's daily forecast.

This intent is used for requests containing expressions such as:

now
today
current weather
The response always uses today's daily forecast.

Even when the user asks about the current time, the Agent still returns the daily forecast for today.

1.3 CheckWeeklyForecast

Returns daily forecast data starting from tomorrow.

Even when the user includes a specific time, the Agent follows the intent and returns daily data only.

Intent Classification Rules

When the request includes a time, hour, or timeOfDay:
From the current time until 23:59 today → CheckHourlyForecast
From 24 hours after the current time onward → CheckWeeklyForecast
When the request includes now or today:
CheckDailyForecast
When the request includes a time at least 24 hours from now, except for rule 2:
CheckWeeklyForecast
2. Weather Card Data

2.1 CheckDailyForecast

Returns:

todayCard
todayCard Data

Precipitation probability from the closest hourly forecast item
Current temperature
Today's highest temperature
Today's lowest temperature
2.2 CheckWeeklyForecast

Returns:

todayCard
weeklyCard
weeklyCard Data

The displayed dates depend on the user's request.

Day-Based Requests

For a request about a specific date, such as:

Weather on the 17th
Weather on Friday
Weather tomorrow
The card shows seven days starting from the requested date.

Week-Based Requests

This applies to requests for:

A full week
Weekdays
The weekend
This Week

Shows seven days starting from tomorrow.

Examples:

This weekend
This week's weekdays
This week
Next Week

Shows seven days starting from next Monday.

Examples:

Next weekend
Next week's weekdays
Next week
The Week After Next

Shows seven days starting from the Monday after next.

Examples:

The weekend after next
The weekdays after next
The week after next
2.3 CheckHourlyForecast

Returns:

todayCard
hourlyCard
hourlyCard Data

The card ignores the exact time requested by the user.

It starts from the next three-hour interval based on the location's current local time.

It then displays seven forecast items at three-hour intervals.

For example:

Current local time: 10:20
First displayed time: 12:00
Following times: 15:00, 18:00, 21:00, and so on
3. timeOfDay Mapping

Time Period	Time Range
Dawn	06:00–08:59
Morning	09:00–11:59
Noon	12:00–13:59
Afternoon	14:00–17:59
Evening	18:00–20:59
Night	21:00–05:59
4. Nearest Future Time Policy

Specific Time

For a request such as:

Tell me the weather at 9.

The Agent selects the nearest future occurrence in this order:

9:00 AM today, if it has not passed
9:00 PM today, if it has not passed
9:00 AM tomorrow
Time Range

For a request such as:

Tell me the morning weather.

The Agent moves the request to tomorrow only when the end of the requested time range has already passed.

If only part of the time range has passed, the Agent follows the partial-range policy described below.

5. Partial Time Range Policy

When the user requests a time range and part of that range is outside the available forecast period, the Agent returns only the available part.

This applies when either:

The beginning of the requested range is unavailable
The end of the requested range is unavailable
6. Multi-Turn Policy

The following information is carried over from the previous turn when it is missing from the current request:

Time

Examples: today, tomorrow, next week, 2:00 PM, three hours later

Location

Examples: Hanoi, Seoul, Tokyo

Metric

Examples: general weather, air quality, humidity, precipitation

Location Carryover

Turn 1

Tell me the weather in Ho Chi Minh City.

Result:

Forecast for Ho Chi Minh City

Turn 2

Tell me the weather.

Result:

Forecast for Ho Chi Minh City

Metric Carryover

Case 1: Metric Carryover Is Reset

Reset Condition 1: The User Asks for General Weather

Turn 1

Tell me the humidity.

Result:

Humidity forecast for Hanoi

Turn 2

Tell me the weather in Ho Chi Minh City.

Result:

General weather forecast for Ho Chi Minh City

The card uses the default metric, airQuality.

Reset Condition 2: The User Asks for Temperature

Turn 1

Tell me the humidity.

Result:

Humidity forecast for Hanoi

Turn 2

Tell me the temperature in Ho Chi Minh City.

Result:

General weather forecast for Ho Chi Minh City

The card uses the default metric, airQuality.

Case 2: Metric Carryover Continues

This applies to all cases that do not match Case 1.

Turn 1

Tell me the humidity.

Result:

Humidity forecast for Hanoi

Turn 2

What about Ho Chi Minh City?

Result:

Humidity forecast for Ho Chi Minh City

Time Carryover

Turn 1

Tell me the weather in Ho Chi Minh City next week.

Result:

Next week's forecast for Ho Chi Minh City

Turn 2

Tell me the weather in Hanoi.

Result:

Next week's forecast for Hanoi

Additional Testing Information

1. The Same Request May Be Classified into Different Intents

The same request is often classified into different intents.

Because the Agent follows the classified intent, the response text and displayed cards may differ even when the user asks the same question.

Please check the classified intent first, and then verify whether the Agent behaved correctly for that intent.

Example:

Tell me tomorrow evening's weather.

This request may be classified as either:

CheckWeeklyForecast
CheckHourlyForecast
The result may therefore differ depending on the classified intent.

Air Quality Data

The following values are different measurements:

Fine dust
Ultrafine dust
AQI (Air Quality Index)
They should not be treated as the same value.

For example, the overall air quality may be moderate even when both fine dust and ultrafine dust levels are poor.

This is because the overall air quality calculation includes other air pollutants in addition to fine dust.