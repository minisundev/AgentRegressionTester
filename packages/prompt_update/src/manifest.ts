import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface PromptEntry {
  file: string;
  promptType: string;
  targets: string[]; // "MainIntent:SubIntent"
  llm_id?: string;
  temperature?: number;
}

export interface Manifest {
  defaults?: { llm_id?: string; temperature?: number };
  prompts: PromptEntry[];
}

export function getPromptsDir(): string {
  return process.env.PROMPTS_DIR
    ? path.resolve(process.env.PROMPTS_DIR)
    : path.resolve(__dirname, '../../../prompts');
}

export function loadManifest(promptsDir: string): Manifest {
  const manifestPath = path.join(promptsDir, 'manifest.yaml');
  const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) as Manifest;

  if (!Array.isArray(manifest?.prompts)) {
    throw new Error(`invalid manifest: "prompts" list missing (${manifestPath})`);
  }
  for (const entry of manifest.prompts) {
    if (!entry.file || !entry.promptType || !Array.isArray(entry.targets) || entry.targets.length === 0) {
      throw new Error(`invalid manifest entry: ${JSON.stringify(entry)} — file/promptType/targets required`);
    }
    for (const target of entry.targets) {
      if (target.split(':').length !== 2) {
        throw new Error(`invalid target "${target}" in ${entry.file} — expected "MainIntent:SubIntent"`);
      }
    }
  }
  return manifest;
}
