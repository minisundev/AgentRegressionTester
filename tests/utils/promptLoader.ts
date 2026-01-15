import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const PROMPT_DIR = path.resolve(__dirname, '../config/prompts');

export function getSheetPrompt(fileName: string): string {
    try {
        const filePath = path.join(PROMPT_DIR, fileName);
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const config = yaml.load(fileContents) as any;
        
        return `${config.judge.instruction} ${config.judge.format}`;
    } catch (error) {
        console.error(`[WARN] Failed to load ${fileName}, using fallback prompt.`, error);
        return "Judge if the response is accurate. Output: 'Pass | [Reason]' or 'Fail | [Reason]'.";
    }
}