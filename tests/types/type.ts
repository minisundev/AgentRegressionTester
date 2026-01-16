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
  reqTranslation: string; //=GOOGLETRANSLATE()
  resTranslation: string; //=GOOGLETRANSLATE()
  judge: string;//=GEMINI()
  time: number;
  reason: string;
  testedAt: string;
}

export type ReportTarget = 'terminal' | 'sheet';
export type JudgeMode = 'none' | 'sheet' | 'api' | 'local';
