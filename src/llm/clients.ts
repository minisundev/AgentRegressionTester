import axios from 'axios';
import OpenAI, { AzureOpenAI } from 'openai';
import type { AnswerModelResult } from '../types/answerCompare.js';
import type { LLMEndpointConfig } from '../types/llm.js';
import { ensureWatcherEnv } from './env.js';
import { getLlmConfigFromRedis } from './redis.js';
import type { DumpedPayload } from './payloadStore.js';

const DEFAULT_MAX_TOKENS = 800;
const HTTP_TIMEOUT_MS = 120_000;

function buildMessages(payload: DumpedPayload): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: payload.prompt },
    { role: 'user', content: payload.userMessage },
  ];
}

function normalizeContent(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '');
}

function asAxiosError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    return `HTTP ${e.response?.status}: ${JSON.stringify(e.response?.data ?? e.message)}`;
  }
  return e instanceof Error ? e.message : String(e);
}

function getGptTestLlmId(): number {
  ensureWatcherEnv();
  return Number(process.env.GPT_TEST_LLM_ID ?? '3');
}

function getGemmaTestLlmId(): number {
  ensureWatcherEnv();
  return Number(process.env.GEMMA_TEST_LLM_ID ?? '2');
}

function getGemmaTestModel(): string {
  ensureWatcherEnv();
  return process.env.GEMMA_TEST_MODEL ?? 'mediaai1/gemma-27b-generation-v3.0.0';
}

function getOllamaUrl(): string {
  ensureWatcherEnv();
  return process.env.OLLAMA_URL ?? 'http://localhost:11434/v1/chat/completions';
}

function getOllamaModel(): string {
  ensureWatcherEnv();
  return process.env.OLLAMA_MODEL ?? 'gemma3:27b';
}

function createCompatibleClient(cfg: LLMEndpointConfig): OpenAI {
  if (cfg.group.toUpperCase().includes('GPT')) {
    return new AzureOpenAI({
      apiKey: cfg.auth_key ?? '',
      baseURL: cfg.url,
      apiVersion: cfg.version,
      deployment: cfg.llm_deploy ?? '',
      timeout: HTTP_TIMEOUT_MS,
    });
  }

  return new OpenAI({
    apiKey: cfg.auth_key ?? '',
    baseURL: cfg.url,
    timeout: HTTP_TIMEOUT_MS,
  });
}

/** Tuned remote Gemma, loaded from config:llm:${GEMMA_TEST_LLM_ID}. */
export async function callGemmaProd(payload: DumpedPayload): Promise<AnswerModelResult> {
  const start = Date.now();
  const llmId = getGemmaTestLlmId();
  const gemmaModel = getGemmaTestModel();
  const cfg = await getLlmConfigFromRedis(llmId);
  if (!cfg) {
    return {
      model: `llm_id=${llmId}`,
      response: '',
      latency: Date.now() - start,
      error: `config:llm:${llmId} not found in Redis`,
    };
  }

  try {
    const res = await axios.post(
      cfg.url,
      {
        model: gemmaModel,
        messages: buildMessages(payload),
        temperature: payload.llmParams.temperature ?? 0.5,
        max_tokens: payload.llmParams.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        generationConfig: {
          response_mime_type: 'text/plain',
        },
        transactionId: payload.trxId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.auth_key ? { Authorization: `Bearer ${cfg.auth_key}` } : {}),
        },
        timeout: HTTP_TIMEOUT_MS,
      },
    );
    const content = res.data?.choices?.[0]?.message?.content ?? res.data?.answer ?? '';
    return {
      model: gemmaModel,
      response: normalizeContent(content),
      latency: Date.now() - start,
    };
  } catch (e) {
    return {
      model: gemmaModel,
      response: '',
      latency: Date.now() - start,
      error: asAxiosError(e),
    };
  }
}

/** Local Ollama via an OpenAI-compatible endpoint. */
export async function callOllama(payload: DumpedPayload): Promise<AnswerModelResult> {
  const start = Date.now();
  const ollamaUrl = getOllamaUrl();
  const ollamaModel = getOllamaModel();
  try {
    const res = await axios.post(
      ollamaUrl,
      {
        model: ollamaModel,
        messages: buildMessages(payload),
        temperature: payload.llmParams.temperature ?? 0.5,
        max_tokens: payload.llmParams.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: HTTP_TIMEOUT_MS,
      },
    );
    const content = res.data?.choices?.[0]?.message?.content ?? '';
    return { model: ollamaModel, response: normalizeContent(content), latency: Date.now() - start };
  } catch (e) {
    return { model: ollamaModel, response: '', latency: Date.now() - start, error: asAxiosError(e) };
  }
}

/** Remote GPT, loaded from config:llm:${GPT_TEST_LLM_ID}. */
export async function callGpt(payload: DumpedPayload): Promise<AnswerModelResult> {
  const start = Date.now();
  const llmId = getGptTestLlmId();
  const cfg = await getLlmConfigFromRedis(llmId);
  if (!cfg) {
    return {
      model: `llm_id=${llmId}`,
      response: '',
      latency: Date.now() - start,
      error: `config:llm:${llmId} not found in Redis`,
    };
  }

  const client = createCompatibleClient(cfg);
  const modelLabel = cfg.llm_deploy ?? cfg.version ?? `llm_id=${llmId}`;

  try {
    const completion = await client.chat.completions.create({
      model: cfg.llm_deploy ?? '',
      messages: buildMessages(payload),
      temperature: payload.llmParams.temperature ?? 0.5,
      top_p: payload.llmParams.topP ?? 1,
      max_tokens: payload.llmParams.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      stream: false,
      store: false,
      ...(payload.llmParams.responseFormat !== 'text'
        ? { response_format: { type: 'json_object' } as const }
        : {}),
    });
    const content = completion.choices?.[0]?.message?.content ?? '';
    return { model: modelLabel, response: normalizeContent(content), latency: Date.now() - start };
  } catch (e) {
    return {
      model: modelLabel,
      response: '',
      latency: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
