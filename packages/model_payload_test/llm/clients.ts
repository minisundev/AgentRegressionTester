import axios from 'axios';
import OpenAI, { AzureOpenAI } from 'openai';
import type { AnswerModelResult, CompareCaseParams } from '../types/answerCompare.js';
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
 * Coerce a payload llmParam / case override to a finite number, falling back
 * when it is undefined/null/'' or otherwise non-numeric. Payloads sometimes
 * carry empty strings for unset params, which `??` does not catch.
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

/** Defensive: trim and strip stray wrapping quotes from a Redis-stored URL. */
function sanitizeUrl(url: string): string {
  return url.trim().replace(/^['"]+|['"]+$/g, '');
}

// Default llm_ids per provider. A case's `llmId` (from YAML) overrides these.
function getGptTestLlmId(): number {
  ensureWatcherEnv();
  return Number(process.env.GPT_TEST_LLM_ID ?? '6');
}

function getGemmaTestLlmId(): number {
  ensureWatcherEnv();
  return Number(process.env.GEMMA_TEST_LLM_ID ?? '2');
}

function getGemmaTestModel(): string {
  ensureWatcherEnv();
  return process.env.GEMMA_TEST_MODEL ?? 'mediaai1/gemma-27b-generation-v3.0.0';
}

function getGeminiTestLlmId(): number {
  ensureWatcherEnv();
  return Number(process.env.GEMINI_TEST_LLM_ID ?? '8');
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

export interface GptOptions {
  /** Redis config:llm:<id>. Defaults to GPT_TEST_LLM_ID. */
  llmId?: number;
  /** Sampling temperature; ignored for GPT-5 family. */
  temperature?: number;
}

/** OpenAI-compatible GPT (Azure), loaded from config:llm:${llmId}. */
export async function callGpt(payload: DumpedPayload, opts: GptOptions = {}): Promise<AnswerModelResult> {
  const start = Date.now();
  const llmId = opts.llmId ?? getGptTestLlmId();
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
            temperature: numParam(opts.temperature ?? payload.llmParams.temperature, 0.5),
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

export interface GemmaOptions {
  /** Redis config:llm:<id>. Defaults to GEMMA_TEST_LLM_ID. */
  llmId?: number;
  temperature?: number;
}

/** Tuned remote Gemma, loaded from config:llm:${llmId}. */
export async function callGemma(payload: DumpedPayload, opts: GemmaOptions = {}): Promise<AnswerModelResult> {
  const start = Date.now();
  const llmId = opts.llmId ?? getGemmaTestLlmId();
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
      sanitizeUrl(cfg.url),
      {
        model: gemmaModel,
        messages: buildMessages(payload),
        temperature: numParam(opts.temperature ?? payload.llmParams.temperature, 0.5),
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
    return { model: gemmaModel, response: normalizeContent(content), latency: Date.now() - start };
  } catch (e) {
    return { model: gemmaModel, response: '', latency: Date.now() - start, error: asAxiosError(e) };
  }
}

export interface GeminiOptions {
  /** Redis config:llm:<id>. Defaults to GEMINI_TEST_LLM_ID. */
  llmId?: number;
  /** Sampling temperature. Defaults to 1.0 (Gemini 3.5 recommended). */
  temperature?: number;
  /** Reasoning level: 'minimal' | 'low' | 'high'. Defaults to 'minimal'. */
  thinkingLevel?: string;
}

/**
 * Google Gemini via the Generative Language REST API (generateContent),
 * loaded from config:llm:${llmId}. The stored `url` is the full generateContent
 * endpoint; `auth_key` is a Google API key sent as `x-goog-api-key`.
 *
 * `opts` overrides temperature/thinkingLevel so the same payload can be swept
 * across multiple configurations. Defaults mirror the production client
 * (temperature 1.0, thinking_level "minimal").
 */
export async function callGemini(payload: DumpedPayload, opts: GeminiOptions = {}): Promise<AnswerModelResult> {
  const start = Date.now();
  const llmId = opts.llmId ?? getGeminiTestLlmId();
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

/** Dispatch a comparison case to its provider client. */
export async function runCompareCase(
  payload: DumpedPayload,
  c: CompareCaseParams,
): Promise<AnswerModelResult> {
  switch (c.provider) {
    case 'gpt':
      return callGpt(payload, { llmId: c.llmId, temperature: c.temperature });
    case 'gemma':
      return callGemma(payload, { llmId: c.llmId, temperature: c.temperature });
    case 'gemini':
      return callGemini(payload, {
        llmId: c.llmId,
        temperature: c.temperature,
        thinkingLevel: c.thinkingLevel,
      });
    default:
      return {
        model: String(c.provider),
        response: '',
        latency: 0,
        error: `unknown provider: ${c.provider}`,
      };
  }
}
