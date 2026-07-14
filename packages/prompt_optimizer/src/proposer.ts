import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ResultRow } from '../../e2e_regression/types/type';
import type { IterationRecord, OptimizerConfig, Proposal } from './types';

const PROMPT_START = '<<<REVISED_PROMPT>>>';
const PROMPT_END = '<<<END_REVISED_PROMPT>>>';

const MAX_FAILURES_IN_CONTEXT = 40;
const MAX_FIELD_CHARS = 2000;

function truncate(value: string | undefined, max = MAX_FIELD_CHARS): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…(truncated)` : value;
}

function formatFailure(f: ResultRow, index: number): string {
  const lines = [
    `### Failure ${index + 1} (case Q${f.id}, group ${f.group})`,
    `- request: ${truncate(f.request)}`,
  ];
  if (f.reqTranslation) lines.push(`- request (translated): ${truncate(f.reqTranslation)}`);
  lines.push(`- agent response: ${truncate(f.response)}`);
  if (f.entity) lines.push(`- extracted entity: ${truncate(f.entity)}`);
  if (f.expectedEntity) lines.push(`- expected entity: ${truncate(f.expectedEntity)}`);
  if (f.entityGoldenDiff) lines.push(`- entity diff: ${truncate(f.entityGoldenDiff)}`);
  lines.push(`- failure reason: ${truncate(f.reason)}`);
  return lines.join('\n');
}

// 프롬프트 내 {language} 같은 런타임 치환 플레이스홀더는 절대 사라지면 안 된다.
export function extractPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? [])];
}

export function validateProposal(original: string, revised: string): string | null {
  if (!revised.trim()) return 'revised prompt is empty';

  const missing = extractPlaceholders(original).filter((ph) => !revised.includes(ph));
  if (missing.length > 0) {
    return `revised prompt dropped required placeholders: ${missing.join(', ')}`;
  }

  const ratio = revised.length / original.length;
  if (ratio < 0.5 || ratio > 2.0) {
    return `revised prompt length changed too much (${Math.round(ratio * 100)}% of original)`;
  }
  return null;
}

function buildInstruction(
  currentPrompt: string,
  failures: ResultRow[],
  policy: string | null,
  history: IterationRecord[],
): string {
  const failureBlock = failures
    .slice(0, MAX_FAILURES_IN_CONTEXT)
    .map(formatFailure)
    .join('\n\n');
  const dropped = failures.length - Math.min(failures.length, MAX_FAILURES_IN_CONTEXT);

  const historyBlock = history.length > 0
    ? history.map((h) => `- ${h.label}: ${h.failCount} failures${h.accepted ? '' : ' (rejected, reverted)'}${h.note ? ` — ${h.note}` : ''}`).join('\n')
    : '(first attempt)';

  return [
    'You are a prompt engineer improving a production system prompt for a weather voice agent.',
    'The prompt below is used by an LLM to parse user queries. Regression tests compare its output against golden expectations, and the failures listed below are what it currently gets wrong.',
    '',
    'Your job: revise the prompt so the failing cases pass WITHOUT breaking the passing ones.',
    '',
    'Rules:',
    '- Make targeted, minimal edits. Do not rewrite sections that are unrelated to the failures.',
    '- Keep the overall structure, numbering, and formatting style of the original.',
    `- Preserve every runtime placeholder exactly (e.g. ${extractPlaceholders(currentPrompt).join(', ') || '{language}'}).`,
    '- Do not add commentary inside the prompt.',
    '- Previous attempts and their scores are listed under ATTEMPT HISTORY — do not repeat an approach that was rejected.',
    '',
    policy ? `## AGENT POLICY (reference)\n${policy}\n` : '',
    `## CURRENT PROMPT\n${currentPrompt}\n`,
    `## FAILING CASES (${failures.length} total${dropped > 0 ? `, showing first ${MAX_FAILURES_IN_CONTEXT}` : ''})\n${failureBlock}\n`,
    `## ATTEMPT HISTORY\n${historyBlock}`,
    '',
    'First write a short analysis of the failure patterns and what you changed (max 15 lines).',
    `Then output the COMPLETE revised prompt between these exact markers:`,
    PROMPT_START,
    '(full prompt text here)',
    PROMPT_END,
  ].filter((line) => line !== '').join('\n');
}

export async function proposeRevision(
  cfg: OptimizerConfig,
  currentPrompt: string,
  failures: ResultRow[],
  policy: string | null,
  history: IterationRecord[],
): Promise<Proposal> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error('AI_API_KEY is required to generate prompt revisions (.env)');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: cfg.model,
    generationConfig: { temperature: cfg.temperature, maxOutputTokens: 65536 },
  });

  let instruction = buildInstruction(currentPrompt, failures, policy, history);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await model.generateContent(instruction);
    const text = result.response.text();

    const start = text.indexOf(PROMPT_START);
    const end = text.lastIndexOf(PROMPT_END);
    if (start === -1 || end === -1 || end <= start) {
      if (attempt === 1) {
        instruction += `\n\nYour previous reply was missing the ${PROMPT_START}/${PROMPT_END} markers. Reply again with the full revised prompt between the markers.`;
        continue;
      }
      throw new Error('LLM response did not contain the revised prompt markers');
    }

    const analysis = text.slice(0, start).trim();
    const revised = text.slice(start + PROMPT_START.length, end).replace(/^\n/, '').replace(/\n$/, '');

    const validationError = validateProposal(currentPrompt, revised);
    if (validationError) {
      if (attempt === 1) {
        console.warn(`[optimizer] proposal rejected: ${validationError} — retrying`);
        instruction += `\n\nYour previous revision was rejected: ${validationError}. Fix this and output the full prompt again between the markers.`;
        continue;
      }
      throw new Error(`proposal validation failed twice: ${validationError}`);
    }

    return { analysis, prompt: revised };
  }

  throw new Error('unreachable');
}
