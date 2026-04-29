export interface TestCase {
  id: string | number;
  name: string;
  message: string;
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
  reason?: string;
  mainIntent?: string;
  subIntent?: string;
  judge?:string;
  time: number;
  entity?: string;
  todayCard?: string;
  card?: string; // weeklyCard or hourlyCard as JSON
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
} as const;

export type SheetColumnKey = keyof typeof SheetColumns;
export type SheetColumnName = typeof SheetColumns[SheetColumnKey];

export const WrapColumns: ReadonlyArray<SheetColumnKey> = ["E", "F", "G", "H"];

export interface SheetRow {
  group: string;
  id: string | number;
  mainIntent: string;
  subIntent: string;
  request: string;
  response: string;
  reqTranslation: string; //=GOOGLETRANSLATE()
  resTranslation: string; //=GOOGLETRANSLATE()
  judge: string;//=GEMINI()
  time: number;
  reason: string;
  testedAt: string;
  entity: string;
  todayCard: string;
  card: string; // weeklyCard or hourlyCard as JSON
}

export type ReportTarget = 'terminal' | 'sheet';
export type JudgeMode = 'none' | 'sheet' | 'api' | 'local';
