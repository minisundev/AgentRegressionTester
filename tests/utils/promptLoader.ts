import fs from 'fs';
import path from 'path';
import from 'js-yaml';
import { ConfigurationError } from '../errors';

const PROMPT_DIR = path.resolve(__dirname, '../config/prompts');

export function getSheetPrompt(fileName: string): string {
    try {
        const filePath = path.join(PROMPT_DIR, fileName);
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const config = yaml.load(fileContents) as any;

        return `${config.judge.instruction} ${config.judge.format}`;
    } catch (error) {
        const configError = new ConfigurationError(
            `Failed to load prompt file: ${fileName}`,
            path.join(PROMPT_DIR, fileName)
        );
        console.error(`[${configError.code}] ${configError.message}`, configError.context);
        return "Judge if the response is accurate. Output: 'Pass | [Reason]' or 'Fail | [Reason]'.";
    }
}
