import axios from 'axios';
import type { OptimizerConfig } from './types';

export async function assertPromptUpdateServer(cfg: OptimizerConfig): Promise<void> {
  try {
    await axios.get(`${cfg.promptUpdateUrl}/status`, { timeout: 5000 });
  } catch {
    throw new Error(
      `prompt_update 서버(${cfg.promptUpdateUrl})에 연결할 수 없습니다. ` +
      '먼저 실행하세요: cd packages/prompt_update && npm run dev'
    );
  }
}

export async function syncPromptFile(cfg: OptimizerConfig, temperature?: number): Promise<void> {
  const body: Record<string, unknown> = { file: cfg.promptFile };
  if (temperature !== undefined) body.temperature = temperature;
  const res = await axios.post(`${cfg.promptUpdateUrl}/promptUpdate`, body, { timeout: 15000 });
  const updated = res.data?.updated ?? '?';
  const tempNote = temperature !== undefined ? `, temp=${temperature}` : '';
  console.log(`[optimizer] prompt synced to Redis (${cfg.promptFile}, updated=${updated}${tempNote})`);
}

export async function getCurrentTemperature(cfg: OptimizerConfig): Promise<number | null> {
  const res = await axios.get(`${cfg.promptUpdateUrl}/status`, { timeout: 5000 });
  const rows: Array<{ file: string; temperature: number | null }> = res.data?.status ?? [];
  return rows.find((r) => r.file === cfg.promptFile)?.temperature ?? null;
}
