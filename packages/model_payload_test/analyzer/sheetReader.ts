import { google } from 'googleapis';
import { ensureWatcherEnv } from '../llm/env.js';

export interface SheetTable {
  header: string[];
  rows: string[][];
}

export function toA1SheetRange(sheetTab: string, cellRange: string): string {
  const escaped = sheetTab.replace(/'/g, "''");
  return `'${escaped}'!${cellRange}`;
}

export function createSheetsClient(readonly: boolean) {
  ensureWatcherEnv();

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');

  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error('Missing GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY in env.');
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      readonly
        ? 'https://www.googleapis.com/auth/spreadsheets.readonly'
        : 'https://www.googleapis.com/auth/spreadsheets',
    ],
  });

  return { sheets: google.sheets({ version: 'v4', auth }), spreadsheetId };
}

/** Read an entire tab; row 1 is the header. Formula cells come back as computed values. */
export async function readSheetTab(tab: string): Promise<SheetTable> {
  const { sheets, spreadsheetId } = createSheetsClient(true);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: toA1SheetRange(tab, 'A:BZ'),
  });

  const values = (res.data.values ?? []).map((row) => row.map((cell) => String(cell ?? '')));
  if (values.length === 0) {
    throw new Error(`Tab "${tab}" is empty or does not exist.`);
  }

  const [header, ...rows] = values;
  return { header, rows };
}
