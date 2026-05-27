import { google } from 'googleapis';
import {
  AnswerCompareSheetColumns,
  type AnswerCompareRow,
} from '../types/answerCompare.js';
import { ensureWatcherEnv } from './env.js';

function getSheetTab(): string {
  ensureWatcherEnv();
  return process.env.GOOGLE_SHEET_TAB ?? 'WeatherAnswerCompare';
}

function getTranslateSourceLanguage(): string {
  ensureWatcherEnv();
  return process.env.GOOGLETRANSLATE_SOURCE_LANGUAGE ?? 'auto';
}

function getTranslateTargetLanguage(): string {
  ensureWatcherEnv();
  return process.env.GOOGLETRANSLATE_TARGET_LANGUAGE ?? 'ko';
}

function toA1SheetRange(sheetTab: string, cellRange: string): string {
  const escaped = sheetTab.replace(/'/g, "''");
  return `'${escaped}'!${cellRange}`;
}

function indexToColumnLetter(index: number): string {
  let n = index + 1;
  let out = '';

  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }

  return out;
}

function buildTranslateFormula(columnLetter: string, rowNumber: number): string {
  return `=GOOGLETRANSLATE(${columnLetter}${rowNumber}, "${getTranslateSourceLanguage()}", "${getTranslateTargetLanguage()}")`;
}

function buildSheetValues(
  rows: AnswerCompareRow[],
  startRow: number,
  headerLabels: string[],
): (string | number)[][] {
  const columnLetters = new Map(headerLabels.map((label, index) => [label, indexToColumnLetter(index)]));

  return rows.map((row, index) => {
    const currentRow = startRow + index;
    const rowWithFormulas: AnswerCompareRow = {
      ...row,
      messageTranslation: buildTranslateFormula(columnLetters.get('Message')!, currentRow),
      gemmaProdResponseTranslation: buildTranslateFormula(columnLetters.get('GemmaProd Response')!, currentRow),
      ollamaResponseTranslation: buildTranslateFormula(columnLetters.get('Ollama Response')!, currentRow),
      gptResponseTranslation: buildTranslateFormula(columnLetters.get('GPT Response')!, currentRow),
      gpt4oResponseTranslation: buildTranslateFormula(columnLetters.get('GPT-4o Response')!, currentRow),
      gpt54ResponseTranslation: buildTranslateFormula(columnLetters.get('GPT-5.4 Response')!, currentRow),
      serviceResponseTranslation: buildTranslateFormula(columnLetters.get('Service Response')!, currentRow),
    };

    return headerLabels.map((label) => {
      const field = AnswerCompareSheetColumns[label];
      const value = field ? rowWithFormulas[field] : '';
      return value ?? '';
    }) as (string | number)[];
  });
}

async function ensureSheetTabExists(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
): Promise<void> {
  const sheetTab = getSheetTab();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = spreadsheet.data.sheets?.some((sheet) => sheet.properties?.title === sheetTab);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetTab,
            },
          },
        },
      ],
    },
  });
}

export async function appendAnswerCompareToSheet(rows: AnswerCompareRow[]): Promise<void> {
  if (rows.length === 0) return;

  const sheetTab = getSheetTab();

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');

  if (!sheetId || !clientEmail || !privateKey) {
    console.warn('[sheets] Missing GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY. Skipping append.');
    return;
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const headerLabels = Object.keys(AnswerCompareSheetColumns);
  const allValues: (string | number)[][] = [];

  try {
    await ensureSheetTabExists(sheets, sheetId);

    const firstColumn = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: toA1SheetRange(sheetTab, 'A:A'),
    });
    const startRow = (firstColumn.data.values?.length ?? 0) + 1;

    const headerRange = toA1SheetRange(sheetTab, '1:1');
    const existingHeader = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: headerRange,
    });
    const hasHeader = (existingHeader.data.values?.[0]?.length ?? 0) > 0;

    if (!hasHeader) {
      allValues.push(headerLabels);
    }

    allValues.push(...buildSheetValues(rows, startRow, headerLabels));

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: toA1SheetRange(sheetTab, 'A1'),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: allValues },
    });
    console.log(`[sheets] appended ${rows.length} rows to "${sheetTab}"`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[sheets] append failed: ${msg}`);
  }
}
