import { z } from 'zod';
import { callGpt } from '../llm/clients.js';
import type { DumpedPayload } from '../llm/payloadStore.js';
import type { LLMEndpointConfig } from '../types/llm.js';
import { isEvaluated } from './metrics.js';
import type { CaseRecord, IssueCluster, IssueForClustering } from './types.js';

/** Keeps a single clustering call within the judge model's context budget. */
const MAX_ISSUES_PER_CATEGORY = 150;
const TEXT_TRUNCATE = 220;

const ClusterResponseSchema = z.object({
  clusters: z.array(z.object({
    name: z.string(),
    description: z.string(),
    issueIndexes: z.array(z.number().int().min(0)),
  })),
});

function getJudgeLlmId(): number | undefined {
  const raw = process.env.GPT_JUDGE_LLM_ID ?? process.env.GPT_TEST_LLM_ID;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function collectIssues(records: CaseRecord[], labels: string[]): IssueForClustering[] {
  const issues: IssueForClustering[] = [];
  for (const record of records) {
    for (const label of labels) {
      if (!isEvaluated(record, label)) continue;
      const m = record.models[label];
      if (m.verdict === 'pass') continue;
      for (const issue of m.issues) {
        issues.push({
          caseId: record.id,
          message: record.messageKo || record.message,
          model: label,
          category: issue.category,
          severity: issue.severity,
          problem: issue.problem.slice(0, TEXT_TRUNCATE),
          evidence: issue.evidence.slice(0, TEXT_TRUNCATE),
        });
      }
    }
  }
  return issues;
}

function buildClusterPrompt(): string {
  return [
    'You are analyzing hallucination issues found by an LLM judge in weather-assistant answers.',
    'Group the numbered issues into recurring PATTERNS (clusters). A pattern is a specific, repeatable failure mode',
    '(e.g. "fineDust field answered as PM10", "relative date recomputed against model clock"), not a broad category.',
    '',
    'Rules:',
    '- Every issue index should be assigned to at most one cluster; leave truly one-off issues unassigned.',
    '- 3 to 10 clusters. Order them by how many issues they contain, descending.',
    '- name: short Korean pattern name. description: 1-2 Korean sentences describing the pattern and typical trigger.',
    '',
    'Return JSON only, no markdown. Schema:',
    '{ "clusters": [{ "name": string, "description": string, "issueIndexes": number[] }] }',
  ].join('\n');
}

function buildJudgePayload(category: string, issues: IssueForClustering[]): DumpedPayload {
  const numbered = issues.map((issue, index) => ({
    index,
    model: issue.model,
    severity: issue.severity,
    userMessage: issue.message,
    problem: issue.problem,
    evidence: issue.evidence,
  }));

  return {
    trxId: `halluc-cluster-${category}`,
    mainIntent: 'Analysis',
    subIntent: 'ClusterIssues',
    language: 'korean',
    prompt: buildClusterPrompt(),
    userMessage: JSON.stringify({ category, issues: numbered }),
    weatherData: '',
    llmParams: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 4000,
      responseFormat: 'json_object',
    },
    // callGpt loads the endpoint from Redis by llmId; this field is unused there.
    connectionConfig: {} as LLMEndpointConfig,
  };
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function toClusters(category: string, issues: IssueForClustering[], parsed: z.infer<typeof ClusterResponseSchema>): IssueCluster[] {
  return parsed.clusters
    .map((cluster) => {
      const members = cluster.issueIndexes
        .filter((i) => i >= 0 && i < issues.length)
        .map((i) => issues[i]);
      if (!members.length) return null;

      const countByModel: Record<string, number> = {};
      for (const member of members) countByModel[member.model] = (countByModel[member.model] ?? 0) + 1;

      return {
        name: cluster.name,
        description: cluster.description,
        category,
        count: members.length,
        countByModel,
        exampleCaseIds: [...new Set(members.map((m) => m.caseId))].slice(0, 5),
        representativeQuote: members[0].problem,
      };
    })
    .filter((c): c is IssueCluster => c !== null);
}

/**
 * Cluster judge issues per category with the judge LLM (temperature 0).
 * Counts/examples are derived from returned issue indexes, not from the
 * model's own counting, so the numbers stay verifiable.
 */
export async function clusterIssues(records: CaseRecord[], labels: string[]): Promise<IssueCluster[]> {
  const all = collectIssues(records, labels);
  const byCategory = new Map<string, IssueForClustering[]>();
  for (const issue of all) {
    (byCategory.get(issue.category) ?? byCategory.set(issue.category, []).get(issue.category)!).push(issue);
  }

  const clusters: IssueCluster[] = [];
  for (const [category, issues] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (issues.length < 3) continue;

    let sample = issues;
    if (issues.length > MAX_ISSUES_PER_CATEGORY) {
      console.warn(`[cluster] ${category}: ${issues.length} issues, clustering first ${MAX_ISSUES_PER_CATEGORY} (${issues.length - MAX_ISSUES_PER_CATEGORY} dropped)`);
      sample = issues.slice(0, MAX_ISSUES_PER_CATEGORY);
    }

    console.log(`[cluster] ${category}: clustering ${sample.length} issues...`);
    const result = await callGpt(buildJudgePayload(category, sample), { llmId: getJudgeLlmId(), temperature: 0 });
    if (result.error) {
      console.warn(`[cluster] ${category}: judge call failed: ${result.error}`);
      continue;
    }

    try {
      const parsed = ClusterResponseSchema.parse(JSON.parse(extractJsonObject(result.response)));
      clusters.push(...toClusters(category, sample, parsed));
    } catch (e) {
      console.warn(`[cluster] ${category}: parse failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return clusters.sort((a, b) => b.count - a.count);
}
