import { z } from 'zod';
import 'dotenv/config';

const knownSheetEnvironmentNames = ['dev', 'stg', 'prod', 'local'] as const;

type KnownSheetEnvironmentName = (typeof knownSheetEnvironmentNames)[number];

const envSchema = z.object({
  // Required - API Configuration
  CONTROL_BASE_URL: z.string().url('CONTROL_BASE_URL must be a valid URL'),
  X_API_KEY: z.string().min(1, 'X_API_KEY is required'),

  // Optional - Device/Client Configuration
  DEVICE_ID: z.string().default('default-device-id'),
  OS_APP_TYPE: z.string().default('android'),
  OS_APP_VERSION: z.string().default('1.0.0'),
  ACCEPT_LANGUAGE: z.string().default('vi'),
  TRACE_ID: z.string().default('default-trace-id'),
  ACCOUNT_ID: z.string().optional(),
  AGENT_VERSION: z.string().optional(),
  LANGUAGE: z.string().default('vietnamese'),

  // Optional - Test Configuration
  REPORT_TO: z.enum(['terminal', 'sheet']).default('terminal'),
  JUDGE_MODE: z.enum(['none', 'sheet', 'api', 'local']).default('none'),
  SERVICE_DELAY_SEC: z.string().transform(Number).default(0),
  TEST_TIMEOUT_SEC: z.string().transform(Number).default(3000),
  TODAY: z.string().optional(),

  // Optional - AI Configuration (required when JUDGE_MODE=api)
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('gemini-3-flash-preview'),

  // Optional - Local AI Configuration (required when JUDGE_MODE=local)
  LOCAL_AI_MODEL: z.string().optional(),
  LOCAL_AI_TEMPERATURE: z.string().transform(Number).default(0.1),
  LOCAL_AI_MAX_TOKEN: z.string().transform(Number).default(150),

  // Optional - Google Sheets Configuration (required when REPORT_TO=sheet)
  GOOGLE_SHEET_ID: z.string().optional(),
  GOOGLE_SHEET_NAME: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1, 'GOOGLE_SHEET_NAME must not be empty').optional()
  ),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLETRANSLATE_SOURCE_LANGUAGE: z.string().default('vi'),
  GOOGLETRANSLATE_TARGET_LANGUAGE: z.string().default('en'),

  // Optional - Slack Configuration
  SLACK_WEBHOOK_URL: z.string().url().optional(),
});

const refinedSchema = envSchema.superRefine((data, ctx) => {
  const explicitSheetName = normalizeSheetName(data.GOOGLE_SHEET_NAME);
  const inferredSheetName = inferSheetNameFromBaseUrl(data.CONTROL_BASE_URL);

  if (
    explicitSheetName &&
    isKnownSheetEnvironmentName(explicitSheetName) &&
    explicitSheetName !== inferredSheetName
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `GOOGLE_SHEET_NAME (${explicitSheetName}) does not match CONTROL_BASE_URL environment (${inferredSheetName})`,
      path: ['GOOGLE_SHEET_NAME'],
    });
  }

  // When JUDGE_MODE=api, AI_API_KEY is required
  if (data.JUDGE_MODE === 'api' && !data.AI_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'AI_API_KEY is required when JUDGE_MODE=api',
      path: ['AI_API_KEY'],
    });
  }

  // When JUDGE_MODE=local, LOCAL_AI_MODEL is required
  if (data.JUDGE_MODE === 'local' && !data.LOCAL_AI_MODEL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'LOCAL_AI_MODEL is required when JUDGE_MODE=local',
      path: ['LOCAL_AI_MODEL'],
    });
  }

  // When REPORT_TO=sheet, Google Sheets credentials are required
  if (data.REPORT_TO === 'sheet') {
    if (!data.GOOGLE_SHEET_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'GOOGLE_SHEET_ID is required when REPORT_TO=sheet',
        path: ['GOOGLE_SHEET_ID'],
      });
    }
    if (!data.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'GOOGLE_SERVICE_ACCOUNT_EMAIL is required when REPORT_TO=sheet',
        path: ['GOOGLE_SERVICE_ACCOUNT_EMAIL'],
      });
    }
    if (!data.GOOGLE_PRIVATE_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'GOOGLE_PRIVATE_KEY is required when REPORT_TO=sheet',
        path: ['GOOGLE_PRIVATE_KEY'],
      });
    }
  }
});

function validateEnv() {
  const result = refinedSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error('Environment validation failed:\n' + errors);
    throw new Error('Invalid environment configuration:\n' + errors);
  }

  const data = result.data;

  return {
    ...data,
    GOOGLE_SHEET_NAME: normalizeSheetName(data.GOOGLE_SHEET_NAME) ?? inferSheetNameFromBaseUrl(data.CONTROL_BASE_URL),
  };
}

export const env = validateEnv();

function normalizeSheetName(sheetName?: string): string | undefined {
  const trimmed = sheetName?.trim();
  return trimmed ? trimmed : undefined;
}

function isKnownSheetEnvironmentName(value: string): value is KnownSheetEnvironmentName {
  return knownSheetEnvironmentNames.includes(value as KnownSheetEnvironmentName);
}

function inferSheetNameFromBaseUrl(baseUrl: string): KnownSheetEnvironmentName {
  const hostname = new URL(baseUrl).hostname.toLowerCase();

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local')) {
    return 'local';
  }
  if (hostname.includes('staging') || hostname.includes('-stg') || hostname.includes('.stg.')) {
    return 'stg';
  }
  if (hostname.includes('dev') || hostname.includes('.dev.')) {
    return 'dev';
  }
  return 'prod';
}

type ParsedEnv = z.infer<typeof refinedSchema>;

export type Env = Omit<ParsedEnv, 'GOOGLE_SHEET_NAME'> & {
  GOOGLE_SHEET_NAME: string;
};
