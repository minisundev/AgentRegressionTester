export interface AnswerModelResult {
  model: string;
  response: string;
  latency: number;
  error?: string;
}

export interface AnswerCompareRow {
  testedAt: string;
  group: string;
  id: string | number;
  message: string;
  messageTranslation?: string;
  subIntent: string;
  language: string;
  weatherDataPayload: string;
  userMessage: string;

  gemmaProdModel: string;
  gemmaProdResponse: string;
  gemmaProdResponseTranslation?: string;
  gemmaProdLatency: number;
  gemmaProdError: string;

  gpt54Model: string;
  gpt54Response: string;
  gpt54ResponseTranslation?: string;
  gpt54Latency: number;
  gpt54Error: string;

  geminiModel: string;
  geminiResponse: string;
  geminiResponseTranslation?: string;
  geminiLatency: number;
  geminiError: string;

  serviceResponse: string;
  serviceResponseTranslation?: string;
}

/** Header label -> row field. Order here is sheet column order. */
export const AnswerCompareSheetColumns: Record<string, keyof AnswerCompareRow> = {
  'Tested At': 'testedAt',
  'Group': 'group',
  'ID': 'id',
  'Message': 'message',
  'Message Translation': 'messageTranslation',
  'SubIntent': 'subIntent',
  'Language': 'language',
  'Weather Data': 'weatherDataPayload',
  'User Message': 'userMessage',
  'GemmaProd Model': 'gemmaProdModel',
  'GemmaProd Response': 'gemmaProdResponse',
  'GemmaProd Response Translation': 'gemmaProdResponseTranslation',
  'GemmaProd Latency': 'gemmaProdLatency',
  'GemmaProd Error': 'gemmaProdError',
  'GPT-5.4 Model': 'gpt54Model',
  'GPT-5.4 Response': 'gpt54Response',
  'GPT-5.4 Response Translation': 'gpt54ResponseTranslation',
  'GPT-5.4 Latency': 'gpt54Latency',
  'GPT-5.4 Error': 'gpt54Error',
  'Gemini Model': 'geminiModel',
  'Gemini Response': 'geminiResponse',
  'Gemini Response Translation': 'geminiResponseTranslation',
  'Gemini Latency': 'geminiLatency',
  'Gemini Error': 'geminiError',
  'Service Response': 'serviceResponse',
  'Service Response Translation': 'serviceResponseTranslation',
};
