export interface TestCase {
  id: string | number;
  name: string;
  message: string;
  reqTranslation?: string;
  isMultiTurn?: boolean;
  subIntent: string;
  mainIntent: string;
  agentType: string;
}

export interface AgentResponse {
  resultCode: number;
  requestMessage: string;
  response: {
    message: string;
    mainIntent: string;
    subIntent: string;
    ttsText: string;
    entity?: Record<string, unknown>;
    todayCard?: Record<string, unknown>;
    weeklyCard?: Record<string, unknown>;
    hourlyCard?: Record<string, unknown>;
  };
}

export interface ResultRow {
  group: string,
  id: number | string;
  request: string;
  response: string;
  reqTranslation?: string;
  isMultiTurn?: boolean;
  reason?: string;
  mainIntent?: string;
  subIntent?: string;
  judge?:string;
  time: number;
  entity?: string;
  todayCard?: string;
  card?: string; // weeklyCard or hourlyCard as JSON
  mode?: RequestMode; // 'sync' (agentChat) or 'stream' (agentChatStream)
  ttft?: number; // time-to-first-token in ms (stream only)
  tokenCount?: number; // number of streamed tokens (stream only)
}

export const SheetColumns = {
  A: "group",
  B: "id",
  C: "mainIntent",
  D: "subIntent",
  E: "request",
  F: "response",
  G: "reqTranslation",
  H: "resTranslation",
  I: "judge",
  J: "time",
  K: "reason",
  L: "testedAt",
  M: "entity",
  N: "todayCard",
  O: "card",
  P: "mode",
  Q: "ttft",
  R: "tokenCount",
} as const;

export type SheetColumnKey = keyof typeof SheetColumns;
export type SheetColumnName = typeof SheetColumns[SheetColumnKey];

export interface SheetRow {
  group: string;
  id: string | number;
  mainIntent: string;
  subIntent: string;
  request: string;
  response: string;
  reqTranslation: string;
  resTranslation: string; //=GOOGLETRANSLATE()
  judge: string;//=GEMINI()
  time: number;
  reason: string;
  testedAt: string;
  entity: string;
  todayCard: string;
  card: string; // weeklyCard or hourlyCard as JSON
  mode: string; // 'sync' or 'stream'
  ttft: number | string; // time-to-first-token in ms (stream only)
  tokenCount: number | string; // number of streamed tokens (stream only)
}

export type ReportTarget = 'terminal' | 'sheet';
export type JudgeMode = 'none' | 'sheet' | 'api' | 'local';
export type RequestMode = 'sync' | 'stream';

// Raw SSE event emitted by the agentChatStream endpoint.
export interface StreamEvent {
  type: string;
  transactionId?: string;
  procTime?: number;
  message?: {
    requestMessage?: string;
    agentType?: string;
    mainIntent?: string;
    subIntent?: string;
    is_token?: string;
    is_end?: string;
    token?: string;
    resultCode?: number;
    resultMessage?: string;
    count?: number;
    list?: string[];
    todayCard?: Record<string, unknown>;
    weeklyCard?: Record<string, unknown>;
    hourlyCard?: Record<string, unknown>;
    entity?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface StreamMetrics {
  ttft?: number; // ms from request start to first token
  tokenCount: number;
  totalTime: number; // ms from request start to stream end
}
