import { GoogleGenerativeAI } from "@google/generative-ai";
import { JudgeMode } from "../types/type";
import axios from "axios";

const genAI = new GoogleGenerativeAI(process.env.AI_API_KEY!);
const model = genAI.getGenerativeModel({ model: process.env.AI_MODEL || 'gemini-3-flash-preview' });

export async function judgeResponse(prompt: string, request: string, response: string, currentRow: number): Promise<string> {
    const judgeMode: JudgeMode = (process.env.JUDGE_MODE as JudgeMode) || 'none';
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
    console.error("[Error] AI Api evaluation failed", error);
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
            Now: ${new Date().toISOString().split('T')[0]}
            `.trim();
        const res = await axios.post('http://localhost:11434/api/generate', {
            model: process.env.LOCAL_AI_MODEL,
            prompt: content,
            stream: false,
            options: {
                temperature: Number(process.env.LOCAL_AI_TEMPERATURE) || 0.1,
                num_predict: Number(process.env.LOCAL_AI_MAX_TOKEN) || 150
            }
        });
        return res.data.response.trim();
    } catch (error) {
        console.error("[Local AI Error]", error);
        return "Error | Local AI evaluation failed";
    }
}