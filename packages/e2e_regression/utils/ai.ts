import { GoogleGenerativeAI } from "@google/generative-ai";
import Redis from 'ioredis';
import OpenAI, { AzureOpenAI } from 'openai';
import { JudgeMode } from "../types/type";
import { ExternalServiceError } from "../errors";
import axios from "axios";
import { env } from "../config/env";

const genAI = new GoogleGenerativeAI(env.AI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: env.AI_MODEL });

interface GptEndpointConfig {
    url: string;
    group: string;
    version: string;
    auth_key: string | null;
    llm_deploy?: string;
}

let gptConfig: GptEndpointConfig | undefined;
let gptClient: OpenAI | undefined;

export async function judgeResponse(prompt: string, request: string, response: string, currentRow: number): Promise<string> {
    const judgeMode: JudgeMode = env.JUDGE_MODE;
    if(judgeMode === 'api'){//gemini api
        return await judgeResponseByAIApi(prompt, request, response);
    }
    if(judgeMode === 'gpt'){
        return await judgeResponseByGpt(prompt, request, response);
    }
    if(judgeMode === 'local'){//ollama local
        return await judgeResponseByLocalAI(prompt, request, response);
    }
    if(judgeMode === 'sheet'){//gemini in sheet
        return await judgeResponseBySheetAI(prompt, currentRow);
    }
    return '';
}

function createRedisClient(): Redis {
    if (env.REDIS_URL) {
        return new Redis(env.REDIS_URL, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
        });
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

async function getGptConfig(): Promise<GptEndpointConfig> {
    if (gptConfig) return gptConfig;

    const redis = createRedisClient();
    try {
        await redis.connect();
        const raw = await redis.get(`config:llm:${env.GPT_JUDGE_LLM_ID}`);
        if (!raw) throw new Error(`config:llm:${env.GPT_JUDGE_LLM_ID} not found in Redis`);
        gptConfig = JSON.parse(raw) as GptEndpointConfig;
        return gptConfig;
    } finally {
        redis.disconnect();
    }
}

function getGptClient(config: GptEndpointConfig): OpenAI {
    if (gptClient) return gptClient;

    if (config.group.toUpperCase().includes('GPT')) {
        gptClient = new AzureOpenAI({
            apiKey: config.auth_key ?? '',
            baseURL: config.url.trim().replace(/^['"]+|['"]+$/g, ''),
            apiVersion: config.version,
            deployment: config.llm_deploy ?? '',
            timeout: 120_000,
        });
    } else {
        gptClient = new OpenAI({
            apiKey: config.auth_key ?? '',
            baseURL: config.url.trim().replace(/^['"]+|['"]+$/g, ''),
            timeout: 120_000,
        });
    }

    return gptClient;
}

// env.TODAY exists to mock the reference date; when unset, derive it from the
// real clock so the judge never sees a stale weekday/date pair.
function todayLabel(): string {
    if (env.TODAY) return env.TODAY;
    const now = new Date();
    const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][now.getDay()];
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${weekday},${yyyy}.${mm}.${dd}`;
}

async function judgeResponseByGpt(prompt: string, request: string, response: string): Promise<string> {
    try {
        const config = await getGptConfig();
        const client = getGptClient(config);
        const isGpt5 = config.group.toUpperCase().includes('GPT5');
        const completion = await client.chat.completions.create({
            model: config.llm_deploy ?? '',
            messages: [
                { role: 'system', content: prompt },
                {
                    role: 'user',
                    content: [
                        '[Target to Evaluate]',
                        `Request: ${request}`,
                        `Response: ${response}`,
                        `Now: ${new Date().toISOString().split('T')[0]}`,
                        `Today: ${todayLabel()}`,
                    ].filter(Boolean).join('\n'),
                },
            ],
            stream: false,
            store: false,
            ...(isGpt5
                ? { max_completion_tokens: env.GPT_JUDGE_MAX_TOKEN }
                : { temperature: 0, max_tokens: env.GPT_JUDGE_MAX_TOKEN }),
        });

        return completion.choices?.[0]?.message?.content?.trim() ?? '';
    } catch (error) {
        const serviceError = new ExternalServiceError('GPT evaluation failed', 'GPT judge', error);
        console.error(`[${serviceError.code}] ${serviceError.message}`, serviceError.context);
        return 'Error | GPT evaluation failed';
    }
}

async function judgeResponseByAIApi(prompt: string, request: string, response: string): Promise<string> {
  try {
    const content = `${prompt} [Target to Evaluate]
        Request: ${request}
        Response: ${response}
        Now: ${new Date().toISOString().split('T')[0]}
        `.trim();

    const result = await model.generateContent(content);
    return result.response.text().trim();
  } catch (error) {
    const serviceError = new ExternalServiceError(
      'AI API evaluation failed',
      'Gemini API',
      error
    );
    console.error(`[${serviceError.code}] ${serviceError.message}`, serviceError.context);
    return "Error | AI evaluation failed";
  }
}

async function judgeResponseBySheetAI(prompt: string, currentRow: number): Promise<string> {
    return `=GEMINI("${prompt},Now: ${new Date().toISOString().split('T')[0]}", E${currentRow}:F${currentRow})`;
}

async function judgeResponseByLocalAI(prompt: string, request: string, response: string): Promise<string> {
    try {
        const content = `${prompt} [Target to Evaluate]
            Request: ${request}
            Response: ${response}
            Now: ${new Date().toISOString().split('T')[0]} , ${todayLabel()} // TODAY=MON,TUE,WED,THU,FRI,SAT,SUN
            `.trim();
        const res = await axios.post('http://localhost:11434/api/generate', {
            model: env.LOCAL_AI_MODEL,
            prompt: content,
            stream: false,
            options: {
                temperature: env.LOCAL_AI_TEMPERATURE,
                num_predict: env.LOCAL_AI_MAX_TOKEN
            }
        });
        return res.data.response.trim();
    } catch (error) {
        const serviceError = new ExternalServiceError(
            'Local AI evaluation failed',
            'Ollama',
            error
        );
        console.error(`[${serviceError.code}] ${serviceError.message}`, serviceError.context);
        return "Error | Local AI evaluation failed";
    }
}
