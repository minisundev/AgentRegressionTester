import { GoogleGenerativeAI } from "@google/generative-ai";
import { JudgeMode } from "../types/type";

const genAI = new GoogleGenerativeAI(process.env.AI_API_KEY!);
const model = genAI.getGenerativeModel({ model: process.env.AI_MODEL || 'gemini-3-flash-preview' });

export async function judgeResponse(prompt: string, request: string, response: string, currentRow: number): Promise<string> {
    const judgeMode: JudgeMode = (process.env.JUDGE_MODE as JudgeMode) || 'none';
    if(judgeMode === 'local'){
        return await judgeResponseByLocalAI(prompt, request, response);
    }
    if(judgeMode === 'sheet'){
        return await judgeResponseBySheetAI(prompt, currentRow);
    }
    return '';
}

async function judgeResponseByLocalAI(prompt: string, request: string, response: string): Promise<string> {
  try {
    
    const content = `${prompt} [Target to Evaluate] 
        Request: ${request}
        Response: ${response}
        Now: ${new Date().toISOString().split('T')[0]}
        `.trim();

    const result = await model.generateContent(content);
    return result.response.text().trim();
  } catch (error) {
    console.error("[Error] AI evaluation failed", error);
    return "Error | AI evaluation failed";
  }
}

async function judgeResponseBySheetAI(prompt: string, currentRow: number): Promise<string> {
    return `=GEMINI("${prompt},Now: ${new Date().toISOString().split('T')[0]}", E${currentRow}:F${currentRow})`;
}