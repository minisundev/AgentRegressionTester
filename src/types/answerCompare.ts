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

  gpt54Model: string;
  gpt54Response: string;
  gpt54ResponseTranslation?: string;
  gpt54Latency: number;
  gpt54Error: string;

  // Gemini parameter sweep: temperature {0.7, 1.0} x thinkingLevel {minimal, low}.
  geminiT07MinModel: string;
  geminiT07MinResponse: string;
  geminiT07MinResponseTranslation?: string;
  geminiT07MinLatency: number;
  geminiT07MinError: string;

  geminiT10MinModel: string;
  geminiT10MinResponse: string;
  geminiT10MinResponseTranslation?: string;
  geminiT10MinLatency: number;
  geminiT10MinError: string;

  geminiT07LowModel: string;
  geminiT07LowResponse: string;
  geminiT07LowResponseTranslation?: string;
  geminiT07LowLatency: number;
  geminiT07LowError: string;

  geminiT10LowModel: string;
  geminiT10LowResponse: string;
  geminiT10LowResponseTranslation?: string;
  geminiT10LowLatency: number;
  geminiT10LowError: string;

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
  'GPT-5.4 Model': 'gpt54Model',
  'GPT-5.4 Response': 'gpt54Response',
  'GPT-5.4 Response Translation': 'gpt54ResponseTranslation',
  'GPT-5.4 Latency': 'gpt54Latency',
  'GPT-5.4 Error': 'gpt54Error',
  'Gemini t0.7 minimal Model': 'geminiT07MinModel',
  'Gemini t0.7 minimal Response': 'geminiT07MinResponse',
  'Gemini t0.7 minimal Response Translation': 'geminiT07MinResponseTranslation',
  'Gemini t0.7 minimal Latency': 'geminiT07MinLatency',
  'Gemini t0.7 minimal Error': 'geminiT07MinError',
  'Gemini t1.0 minimal Model': 'geminiT10MinModel',
  'Gemini t1.0 minimal Response': 'geminiT10MinResponse',
  'Gemini t1.0 minimal Response Translation': 'geminiT10MinResponseTranslation',
  'Gemini t1.0 minimal Latency': 'geminiT10MinLatency',
  'Gemini t1.0 minimal Error': 'geminiT10MinError',
  'Gemini t0.7 low Model': 'geminiT07LowModel',
  'Gemini t0.7 low Response': 'geminiT07LowResponse',
  'Gemini t0.7 low Response Translation': 'geminiT07LowResponseTranslation',
  'Gemini t0.7 low Latency': 'geminiT07LowLatency',
  'Gemini t0.7 low Error': 'geminiT07LowError',
  'Gemini t1.0 low Model': 'geminiT10LowModel',
  'Gemini t1.0 low Response': 'geminiT10LowResponse',
  'Gemini t1.0 low Response Translation': 'geminiT10LowResponseTranslation',
  'Gemini t1.0 low Latency': 'geminiT10LowLatency',
  'Gemini t1.0 low Error': 'geminiT10LowError',
  'Service Response': 'serviceResponse',
  'Service Response Translation': 'serviceResponseTranslation',
};
