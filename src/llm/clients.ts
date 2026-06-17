import axios from 'axios';
import OpenAI, { AzureOpenAI } from 'openai';
import type { AnswerModelResult } from '../types/answerCompare.js';
import type { LLMEndpointConfig } from '../types/llm.js';
import { ensureWatcherEnv } from './env.js';
import { getLlmConfigFromRedis } from './redis.js';
import type { DumpedPayload } from './payloadStore.js';

const DEFAULT_MAX_TOKENS = 1024;
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

/**
 * Coerce a payload llmParam to a finite number, falling back when it is
 * undefined/null/'' or otherwise non-numeric. Payloads sometimes carry empty
 * strings for unset params, which `??` does not catch.
 */
function numParam(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && value !== '' && value !== null ? n : fallback;
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

function getGpt4oTestLlmId(): number {
  ensureWatcherEnv();
  return Number(process.env.GPT_4O_TEST_LLM_ID ?? '4');
}

function getGpt54TestLlmId(): number {
  ensureWatcherEnv();
  return Number(process.env.GPT_5_4_TEST_LLM_ID ?? '6');
}

function getGeminiTestLlmId(): number {
  ensureWatcherEnv();
  return Number(process.env.GEMINI_TEST_LLM_ID ?? '8');
}

/** Defensive: trim and strip stray wrapping quotes from a Redis-stored URL. */
function sanitizeUrl(url: string): string {
  return url.trim().replace(/^['"]+|['"]+$/g, '');
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
        temperature: numParam(payload.llmParams.temperature, 0.5),
        max_tokens: numParam(payload.llmParams.maxOutputTokens, DEFAULT_MAX_TOKENS),
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

async function callGptByLlmId(payload: DumpedPayload, llmId: number): Promise<AnswerModelResult> {
  const start = Date.now();
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

  // GPT-5 family uses `max_completion_tokens` (not `max_tokens`) and only
  // supports the default temperature, so omit the custom sampling params.
  const isGpt5 = cfg.group.toUpperCase().includes('GPT5');
  const maxTokens = numParam(payload.llmParams.maxOutputTokens, DEFAULT_MAX_TOKENS);

  try {
    const completion = await client.chat.completions.create({
      model: cfg.llm_deploy ?? '',
      messages: buildMessages(payload),
      stream: false,
      store: false,
      ...(isGpt5
        ? { max_completion_tokens: maxTokens }
        : {
            temperature: numParam(payload.llmParams.temperature, 0.5),
            top_p: numParam(payload.llmParams.topP, 1),
            max_tokens: maxTokens,
          }),
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

/** Remote GPT, loaded from config:llm:${GPT_TEST_LLM_ID}. */
export async function callGpt(payload: DumpedPayload): Promise<AnswerModelResult> {
  return callGptByLlmId(payload, getGptTestLlmId());
}

/** Remote GPT-4o, loaded from config:llm:${GPT_4O_TEST_LLM_ID}. */
export async function callGpt4o(payload: DumpedPayload): Promise<AnswerModelResult> {
  return callGptByLlmId(payload, getGpt4oTestLlmId());
}

/** Remote GPT-5.4, loaded from config:llm:${GPT_5_4_TEST_LLM_ID}. */
export async function callGpt54(payload: DumpedPayload): Promise<AnswerModelResult> {
  return callGptByLlmId(payload, getGpt54TestLlmId());
}

/** Per-call Gemini tuning knobs for the parameter sweep. */
export interface GeminiOptions {
  /** Sampling temperature. Defaults to 1.0 (Gemini 3.5 recommended). */
  temperature?: number;
  /** Reasoning level: 'minimal' | 'low' | 'high'. Defaults to 'minimal'. */
  thinkingLevel?: string;
}

/**
 * Google Gemini via the Generative Language REST API (generateContent),
 * loaded from config:llm:${GEMINI_TEST_LLM_ID}. The stored `url` is the full
 * generateContent endpoint; `auth_key` is a Google API key sent as
 * `x-goog-api-key`.
 *
 * `opts` overrides temperature/thinkingLevel so the same payload can be swept
 * across multiple configurations. Defaults mirror the production client
 * (temperature 1.0, thinking_level "minimal").
 */
export async function callGemini(
  payload: DumpedPayload,
  opts: GeminiOptions = {},
): Promise<AnswerModelResult> {
  const start = Date.now();
  const llmId = getGeminiTestLlmId();
  const temperature = opts.temperature ?? 1.0;
  const thinkingLevel = opts.thinkingLevel ?? 'minimal';
  const cfg = await getLlmConfigFromRedis(llmId);
  if (!cfg) {
    return {
      model: `llm_id=${llmId}`,
      response: '',
      latency: Date.now() - start,
      error: `config:llm:${llmId} not found in Redis`,
    };
  }

  const geminiModel = cfg.llm_deploy ?? cfg.version ?? `llm_id=${llmId}`;

  try {
    const res = await axios.post(
      sanitizeUrl(cfg.url),
      {
        system_instruction: { parts: [{ text: payload.prompt }] },
        contents: [{ role: 'user', parts: [{ text: payload.userMessage }] }],
        generationConfig: {
          // thinkingLevel keeps reasoning from eating maxOutputTokens and
          // truncating the answer; temperature follows the swept config.
          temperature,
          maxOutputTokens: numParam(payload.llmParams.maxOutputTokens, DEFAULT_MAX_TOKENS),
          responseMimeType: 'text/plain',
          thinkingConfig: { thinkingLevel },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.auth_key ? { 'x-goog-api-key': cfg.auth_key } : {}),
        },
        timeout: HTTP_TIMEOUT_MS,
      },
    );
    const candidate = res.data?.candidates?.[0];
    const parts = candidate?.content?.parts;
    const content = Array.isArray(parts)
      ? parts.map((part: { text?: string }) => part?.text ?? '').join('')
      : '';
    if (!content) {
      // 200 OK but nothing usable: surface the reason instead of a silent blank.
      const reason =
        res.data?.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'no content in response';
      return {
        model: geminiModel,
        response: '',
        latency: Date.now() - start,
        error: `empty response (${reason})`,
      };
    }
    return { model: geminiModel, response: normalizeContent(content), latency: Date.now() - start };
  } catch (e) {
    return { model: geminiModel, response: '', latency: Date.now() - start, error: asAxiosError(e) };
  }
}
