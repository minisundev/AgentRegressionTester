import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { CompareCase } from '../types/answerCompare.js';

const CONFIG_PATH = process.env.ANSWER_COMPARE_CONFIG
  ? path.resolve(process.cwd(), process.env.ANSWER_COMPARE_CONFIG)
  : path.resolve(__dirname, 'answerCompare.yaml');

const CaseSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  provider: z.enum(['gpt', 'gemini', 'gemma']),
  llmId: z.number().int().optional(),
  temperature: z.number().optional(),
  thinkingLevel: z.string().optional(),
});

const FileSchema = z.object({
  cases: z.array(CaseSchema).min(1),
});

let cached: CompareCase[] | null = null;

/** Load the comparison cases from answerCompare.yaml (cached per process). */
export function loadCompareCases(): CompareCase[] {
  if (cached) return cached;

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = FileSchema.parse(yaml.load(raw) ?? {});

  const keys = new Set<string>();
  for (const c of parsed.cases) {
    if (keys.has(c.key)) {
      throw new Error(`[answerCompare] duplicate case key: "${c.key}" in ${CONFIG_PATH}`);
    }
    keys.add(c.key);
  }

  cached = parsed.cases;
  return cached;
}
