export interface LLMEndpointConfig {
  url: string;
  group: string;
  version: string;
  auth_key: string | null;
  llm_deploy?: string;
}

export interface LLMParams {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  responseFormat?: string;
  reasoningEffort?: string;
}
