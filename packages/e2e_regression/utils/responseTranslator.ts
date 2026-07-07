import Redis from 'ioredis';
import OpenAI, { AzureOpenAI } from 'openai';
import { env } from '../config/env';
import { getPromptText } from './promptLoader';

interface LlmEndpointConfig {
    url: string;
    group: string;
    version: string;
    auth_key: string | null;
    llm_deploy?: string;
}

let cachedConfig: LlmEndpointConfig | null | undefined;
let cachedClient: OpenAI | undefined;

function createRedisClient(): Redis {
    if (env.REDIS_URL) {
        return new Redis(env.REDIS_URL, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
        });
    }

    if (!env.REDIS_ENDPOINT || !env.REDIS_PORT) {
        throw new Error('Set REDIS_URL or REDIS_ENDPOINT + REDIS_PORT for GPT response translation');
    }

    return new Redis({
        host: env.REDIS_ENDPOINT,
        port: Number(env.REDIS_PORT),
        password: env.REDIS_PASSWD?.trim() || undefined,
        tls: env.REDIS_SSL === 'true' ? {} : undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
    });
}

async function getLlmConfig(): Promise<LlmEndpointConfig | undefined> {
    if (cachedConfig !== undefined) return cachedConfig ?? undefined;

    const redis = createRedisClient();
    try {
        await redis.connect();
        const raw = await redis.get(`config:llm:${env.RESPONSE_TRANSLATION_LLM_ID}`);
        cachedConfig = raw ? JSON.parse(raw) as LlmEndpointConfig : null;
        return cachedConfig ?? undefined;
    } finally {
        redis.disconnect();
    }
}

function getClient(config: LlmEndpointConfig): OpenAI {
    if (cachedClient) return cachedClient;

    if (config.group.toUpperCase().includes('GPT')) {
        cachedClient = new AzureOpenAI({
            apiKey: config.auth_key ?? '',
            baseURL: config.url,
            apiVersion: config.version,
            deployment: config.llm_deploy ?? '',
            timeout: 120_000,
        });
        return cachedClient;
    }

    cachedClient = new OpenAI({
        apiKey: config.auth_key ?? '',
        baseURL: config.url,
        timeout: 120_000,
    });
    return cachedClient;
}

function targetLanguageName(languageCode: string): string {
    const normalized = languageCode.toLowerCase();
    if (normalized === 'ko' || normalized === 'kr' || normalized === 'korean') return 'Korean';
    if (normalized === 'en' || normalized === 'english') return 'English';
    if (normalized === 'vi' || normalized === 'vietnamese') return 'Vietnamese';
    return languageCode;
}

function sourceLanguageName(languageCode: string): string {
    const normalized = languageCode.toLowerCase();
    if (normalized === 'auto') return 'the detected source language';
    return targetLanguageName(languageCode);
}

function buildTranslationPrompt(): string {
    const sourceLanguage = sourceLanguageName(env.GOOGLETRANSLATE_SOURCE_LANGUAGE);
    const targetLanguage = targetLanguageName(env.GOOGLETRANSLATE_TARGET_LANGUAGE);
    const template = getPromptText(env.RESPONSE_TRANSLATION_PROMPT_FILE, 'translate')
        || 'Translate the input text from {{sourceLanguage}} to {{targetLanguage}}. Return only the translation.';

    return template
        .replace(/\{\{sourceLanguage\}\}/g, sourceLanguage)
        .replace(/\{\{targetLanguage\}\}/g, targetLanguage);
}

export function shouldUseGptResponseTranslation(): boolean {
    return env.RESPONSE_TRANSLATION_PROVIDER === 'gpt';
}

export async function translateResponseWithGpt(response: string): Promise<string> {
    const text = response.trim();
    if (!text) return '';

    const config = await getLlmConfig();
    if (!config) {
        throw new Error(`config:llm:${env.RESPONSE_TRANSLATION_LLM_ID ?? ''} not found in Redis`);
    }

    const client = getClient(config);
    const completion = await client.chat.completions.create({
        model: config.llm_deploy ?? config.version ?? '',
        messages: [
            {
                role: 'system',
                content: buildTranslationPrompt(),
            },
            {
                role: 'user',
                content: text,
            },
        ],
        temperature: 0,
        max_tokens: env.RESPONSE_TRANSLATION_MAX_TOKEN,
        stream: false,
    });

    return completion.choices?.[0]?.message?.content?.trim() ?? '';
}
