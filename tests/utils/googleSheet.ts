import { google } from "googleapis";
import { ResultRow, SheetColumns, SheetRow } from "../types/type";
import { getSheetPrompt } from "./promptLoader";

export async function appendRowsToSheet(rows: ResultRow[]) {
    if (rows.length === 0) return;

    const sheetId = process.env.GOOGLE_SHEET_ID!;
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    const auth = new google.auth.JWT({ 
        email: clientEmail, 
        key: privateKey, 
        scopes: ['https://www.googleapis.com/auth/spreadsheets'] 
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const range = 'Results!A:A';
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range,
    });

    const startRow = (response.data.values?.length || 0) + 1;

    const values: any[][] = rows.map((r, index) => {
        const req = r.request ?? '';

        const cleanResponse = r.response?.replace(/\n/g, ' ').trim() ?? '';
        const currentRow = startRow + index;
        const prompt = getSheetPrompt('prompt.sheet.yaml');

        const rowData: SheetRow = {
            group: r.group ?? '',
            id: r.id ?? '',
            mainIntent: r.mainIntent ?? '',
            subIntent: r.subIntent ?? '',
            request: r.request ?? '',
            response: cleanResponse,
            translation: `=GOOGLETRANSLATE(F${currentRow}, "auto", "en")`,
            gemini: `=GEMINI("${prompt}", E${currentRow}:F${currentRow})`,
            tts: r.tts ?? '',
            time: r.time ?? 0,
            reason: r.reason ?? '',
            testedAt: new Date().toISOString()
        };

        return Object.keys(SheetColumns).map((key) => rowData[SheetColumns[key as keyof typeof SheetColumns] as keyof SheetRow]);
  });

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
    console.log(`[SUCCESS] ${rows.length} rows appended to Google Sheet.`);
  } catch (error) {
    console.error('[FAIL] failed to append rows to Google Sheet:', error);
  }
}