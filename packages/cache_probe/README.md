# cache_probe

api-gateway-core의 날씨 엔드포인트를 **에이전트를 거치지 않고 직접** 두드려서
게이트웨이 캐시 정합성 버그의 증거를 수집하는 포렌식 프로브.

**검증하려는 가설**: 캐시 키가 resolved city id가 아니라 **raw `q` 문자열**로 잡혀 있다.
같은 도시의 여러 표기(`"Hà Nội,VN"` / `"hanoi,VN"` / `"Hanoi,VN"`)를 같은 라운드에 호출했을 때
resolved city id는 같은데 `dt`(데이터 시각)/응답 지문이 다르면 → 캐시 파편화(DIVERGENCE).
라운드를 거듭해도 특정 표기의 `dt`가 얼어 있으면(frozen) → 라이브가 아닌 캐시를 보고 있다는 증거.

## 실행 (레포 루트에서)

```bash
npm run probe:cache

# 무한 반복 (Ctrl+C까지), 60초 간격
CACHE_PROBE_ROUNDS=0 CACHE_PROBE_INTERVAL_SEC=60 npm run probe:cache

# 파편화 발견 즉시 중단
CACHE_PROBE_ROUNDS=0 CACHE_PROBE_STOP_ON_DIVERGENCE=1 npm run probe:cache

# 장기 실행 시 시트 탭 분리
CACHE_PROBE_SHEET_TAB=WeatherCacheProbe_LongRun npm run probe:cache
```

## 동작 방식

1. 대상 URL: `CACHE_PROBE_BASE_URL`이 있으면 그대로, 없으면 `CONTROL_BASE_URL`의 origin + `/api-gateway-core/v1/external/weather`.
2. 매 라운드, **endpoint → q표기 → 반복횟수** 순서로 GET 호출:
   `GET <base>/<endpoint>?q=<q>&cnt=<cnt>` — 반복 기본 2회 (1회차=MISS 유도, 2회차=HIT 확인).
3. 요청마다 greppable한 `transactionId: cacheprobe-<uuid>` 헤더를 보낸다 → 게이트웨이 팀이 로그에서 정확한 호출을 찾을 수 있음. 응답의 trace id, `X-Cache`/`CF-Cache-Status`/`Age` 헤더도 수집.
4. 응답에서 city id/좌표/dt/temp/humidity를 뽑고 정규화된 payload의 SHA1 지문을 만든다.
5. 라운드마다: 같은 location(id 기준)인데 표기별로 `dt;지문`이 갈리면 **DIVERGENCE** 리포트 (표기별 상세 + 송수신 trxId 포함). 라운드 간에는 표기별 `dt` 변화를 추적해 `frozen:`(캐시 고착) / `refreshed:`(TTL 경계 통과) 판정.
6. 종료 시 요약: `Rounds with cache fragmentation: X/Y`.

## 출력

- **터미널 전용** (의도적으로 파일을 쓰지 않음 — 스스로 쓴 파일은 증거 능력이 없다는 설계.
  기록이 필요하면 `npm run probe:cache | tee logs/probe.log`).
  라운드별 표: wall(utc), endpoint, q, attempt, status, id, coord, dt(local), stale(s), temp, hum, fp, X-Cache, Age.
- **Google Sheet** (기본 켜짐, `CACHE_PROBE_SHEET=0`으로 끔): 탭 `WeatherCacheProbe`에
  Run ID / Round / Endpoint / Query / Attempt / City ID / dt / Fingerprint / X-Cache / Age /
  송수신 TxID / Round Diverged / Details / Error 컬럼으로 라운드마다 append.

## 환경변수

| 변수 | 기본 | 설명 |
|---|---|---|
| `CACHE_PROBE_BASE_URL` 또는 `CONTROL_BASE_URL` | — | 게이트웨이 주소 (둘 중 하나 필수) |
| `CACHE_PROBE_QUERIES` | `Hà Nội,VN \| hanoi,VN \| Hanoi,VN` | 파이프(`\|`) 구분 q 표기들 |
| `CACHE_PROBE_ENDPOINTS` | current,hourly,daily,air-quality/current,air-quality/forecast | 콤마 구분 (`all` = 기본 전체) |
| `CACHE_PROBE_ROUNDS` | 15 | `<=0`이면 무한 |
| `CACHE_PROBE_INTERVAL_SEC` | 60 | 라운드 간격 |
| `CACHE_PROBE_REPEAT` | 2 | 라운드당 같은 q 반복 호출 수 |
| `CACHE_PROBE_CNT` / `CACHE_PROBE_LANG` | 1 / en | 쿼리 파라미터 / Accept-Language |
| `CACHE_PROBE_STOP_ON_DIVERGENCE` | 0 | 1이면 첫 파편화에서 중단 |
| `CACHE_PROBE_DUMP_BODY` | 0 | 파싱 실패 시 본문 앞 500자 출력 |
| `CACHE_PROBE_SHEET` / `CACHE_PROBE_SHEET_TAB` | 1 / WeatherCacheProbe | 시트 기록 |
| `X_API_KEY` | — | 있으면 x-api-key 헤더로 전송 |
| `GOOGLE_SHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` | — | 시트 인증 |

## 주의

- Redis를 쓰지 않는 유일한 패키지 — 게이트웨이 HTTP + (선택) 시트만.
- non-2xx도 에러로 던지지 않고 기록한다 (`validateStatus: true`, 타임아웃 20초).
- 파편화는 TTL 경계에서 간헐적으로 나타난다 — 한 번에 안 잡히면 라운드를 늘려 재실행.
