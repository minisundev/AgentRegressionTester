import { google } from "googleapis";
import { JudgeMode, ResultRow, SheetColumns, SheetRow } from "../types/type";
import { getSheetPrompt } from "./promptLoader";
import { judgeResponse } from "./ai";
import { ExternalServiceError } from "../errors";
import { env } from "../config/env";

export async function appendRowsToSheet(rows: ResultRow[]) {
    if (rows.length === 0) return;

    const sheetId = env.GOOGLE_SHEET_ID!;
    const clientEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
    const privateKey = (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

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
    const values = await processResponseForSheet(rows, startRow);

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
    console.log(`[SUCCESS] ${rows.length} rows appended to Google Sheet.`);
  } catch (error) {
    const serviceError = new ExternalServiceError(
      'Failed to append rows to Google Sheet',
      'Google Sheets',
      error
    );
    console.error(`[${serviceError.code}] ${serviceError.message}`, serviceError.context);
  }
}

function getPrompt() : string{
    const judgeMode: JudgeMode = env.JUDGE_MODE;
    if(judgeMode === 'sheet'){
        return getSheetPrompt('prompt.sheet.yaml')
    }
    if(judgeMode === 'api' || judgeMode === 'local'){
        return getSheetPrompt('prompt.ai.yaml');
    }
    return '';
}

async function processResponseForSheet(rows: ResultRow[], startRow: number): Promise<any[][]> {
    const prompt = getPrompt();

    // Promise<any[]>[]
    const promises = rows.map(async (r, index) => {
        const cleanResponse = r.response?.replace(/\n/g, ' ').trim() ?? '';
        const currentRow = startRow + index;

        const rowData: SheetRow = {
            group: r.group ?? '',
            id: r.id ?? '',
            mainIntent: r.mainIntent ?? '',
            subIntent: r.subIntent ?? '',
            request: r.request ?? '',
            response: cleanResponse,
            reqTranslation: `=GOOGLETRANSLATE(E${currentRow}, "${env.GOOGLETRANSLATE_SOURCE_LANGUAGE}", "${env.GOOGLETRANSLATE_TARGET_LANGUAGE}")`,
            resTranslation: `=GOOGLETRANSLATE(F${currentRow}, "${env.GOOGLETRANSLATE_SOURCE_LANGUAGE}", "${env.GOOGLETRANSLATE_TARGET_LANGUAGE}")`,
            judge: await judgeResponse(prompt, r.request ?? '', cleanResponse, currentRow),
            time: r.time ?? 0,
            reason: r.reason ?? '',
            testedAt: new Date().toISOString(),
            todayCard: r.todayCard ?? '',
            card: r.card ?? '',
        };

        return Object.keys(SheetColumns).map((key) => rowData[SheetColumns[key as keyof typeof SheetColumns] as keyof SheetRow]);
    });

    // 모든 Promise가 해결될 때까지 기다림
    const values = await Promise.all(promises);
    return values;
}
