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

  ollamaModel: string;
  ollamaResponse: string;
  ollamaResponseTranslation?: string;
  ollamaLatency: number;
  ollamaError: string;

  gptModel: string;
  gptResponse: string;
  gptResponseTranslation?: string;
  gptLatency: number;
  gptError: string;

  gpt4oModel: string;
  gpt4oResponse: string;
  gpt4oResponseTranslation?: string;
  gpt4oLatency: number;
  gpt4oError: string;

  gpt54Model: string;
  gpt54Response: string;
  gpt54ResponseTranslation?: string;
  gpt54Latency: number;
  gpt54Error: string;

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
  'Ollama Model': 'ollamaModel',
  'Ollama Response': 'ollamaResponse',
  'Ollama Response Translation': 'ollamaResponseTranslation',
  'Ollama Latency': 'ollamaLatency',
  'Ollama Error': 'ollamaError',
  'GPT Model': 'gptModel',
  'GPT Response': 'gptResponse',
  'GPT Response Translation': 'gptResponseTranslation',
  'GPT Latency': 'gptLatency',
  'GPT Error': 'gptError',
  'GPT-4o Model': 'gpt4oModel',
  'GPT-4o Response': 'gpt4oResponse',
  'GPT-4o Response Translation': 'gpt4oResponseTranslation',
  'GPT-4o Latency': 'gpt4oLatency',
  'GPT-4o Error': 'gpt4oError',
  'GPT-5.4 Model': 'gpt54Model',
  'GPT-5.4 Response': 'gpt54Response',
  'GPT-5.4 Response Translation': 'gpt54ResponseTranslation',
  'GPT-5.4 Latency': 'gpt54Latency',
  'GPT-5.4 Error': 'gpt54Error',
  'Service Response': 'serviceResponse',
  'Service Response Translation': 'serviceResponseTranslation',
};
