import { GoogleGenerativeAI } from "@google/generative-ai";
import { JudgeMode } from "../types/type";
import { ExternalServiceError } from "../errors";
import axios from "axios";
import { env } from "../config/env";

const genAI = new GoogleGenerativeAI(env.AI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: env.AI_MODEL });

export async function judgeResponse(prompt: string, request: string, response: string, currentRow: number): Promise<string> {
    const judgeMode: JudgeMode = env.JUDGE_MODE;
    if(judgeMode === 'api'){//gemini api
        return await judgeResponseByAIApi(prompt, request, response);
    }
    if(judgeMode === 'local'){//ollama local
        return await judgeResponseByLocalAI(prompt, request, response);
    }
    if(judgeMode === 'sheet'){//gemini in sheet
        return await judgeResponseBySheetAI(prompt, currentRow);
    }
    return '';
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
            Now: ${new Date().toISOString().split('T')[0]} , ${env.TODAY} // TODAY=MON,TUE,WED,THU,FRI,SAT,SUN
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
