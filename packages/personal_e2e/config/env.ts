import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  // aia-personal 서버 (기본: 로컬 uvicorn, SRV_PORT=8080)
  PERSONAL_BASE_URL: z.string().url().default('http://localhost:8080/aia-personal/v1'),
  // aia-personal web/_middle.py 의 header_checker 가 검사하는 x-api-key.
  // 값은 커밋하지 말고 .env 에 PERSONAL_X_API_KEY 로 넣을 것 (없으면 X_API_KEY 재사용).
  PERSONAL_X_API_KEY: z.string().optional(),
  X_API_KEY: z.string().optional(),

  DEVICE_ID: z.string().default('default-device-id'),
  OS_APP_TYPE: z.string().default('android'),
  OS_APP_VERSION: z.string().default('1.0.0'),
  TRACE_ID: z.string().default('default-trace-id'),
  ACCOUNT_ID: z.string().default('personal-e2e'),
  AGENT_VERSION: z.string().default('1.0.0'),

  PERSONAL_LANGUAGE: z.enum(['vietnamese', 'english']).default('vietnamese'),
  // terminal | sheet — sheet 면 GOOGLE_* 설정 필요 (weather e2e 와 같은 서비스 계정 재사용)
  PERSONAL_REPORT_TO: z.enum(['terminal', 'sheet']).default('terminal'),
  PERSONAL_SHEET_NAME: z.string().default('personal_e2e'),
  GOOGLE_SHEET_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  // config/testcases/ 밑의 yaml 파일명, 콤마 구분
  PERSONAL_CASE_GROUPS: z.string().default('personal_smoke.yaml'),
  PERSONAL_TURN_TIMEOUT_SEC: z.coerce.number().default(60),
  PERSONAL_RESULT_JSON_PATH: z.string().optional(),
  // 케이스 이름/ID 부분 일치 필터 (선택)
  PERSONAL_CASE_FILTER: z.string().optional(),

  // 디바이스 콜백 시뮬레이터가 publish 할 Redis (에이전트와 같은 인스턴스여야 함)
  REDIS_URL: z.string().optional(),
  REDIS_ENDPOINT: z.string().optional(),
  REDIS_PORT: z.coerce.number().optional(),
  REDIS_PASSWD: z.string().optional(),
  REDIS_SSL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[personal_e2e] invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export function requireApiKey(): string {
  const key = env.PERSONAL_X_API_KEY ?? env.X_API_KEY;
  if (!key) {
    console.error('[personal_e2e] PERSONAL_X_API_KEY (또는 X_API_KEY) 가 .env 에 필요합니다.');
    process.exit(1);
  }
  return key;
}
