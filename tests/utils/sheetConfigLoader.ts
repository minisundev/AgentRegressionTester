import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { SheetColumnKey, SheetColumns } from '../types/type';
import { ConfigurationError } from '../errors';

const SHEET_CONFIG_PATH = path.resolve(__dirname, '../config/sheet.yaml');

interface SheetConfigFile {
  wrapColumns?: string[];
}

interface SheetConfig {
  wrapColumns: ReadonlyArray<SheetColumnKey>;
}

let cached: SheetConfig | null = null;

export function loadSheetConfig(): SheetConfig {
  if (cached) return cached;

  try {
    const fileContents = fs.readFileSync(SHEET_CONFIG_PATH, 'utf8');
    const data = (yaml.load(fileContents) ?? {}) as SheetConfigFile;
    const validKeys = new Set(Object.keys(SheetColumns));

    const wrapColumns = (data.wrapColumns ?? [])
      .map((k) => k.trim().toUpperCase())
      .filter((k): k is SheetColumnKey => validKeys.has(k));

    cached = { wrapColumns };
    return cached;
  } catch (error) {
    const configError = new ConfigurationError(
      'Failed to load sheet config',
      SHEET_CONFIG_PATH
    );
    console.error(`[${configError.code}] ${configError.message}`, configError.context);
    throw configError;
  }
}
