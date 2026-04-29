import { google, sheets_v4 } from "googleapis";
import { JudgeMode, ResultRow, SheetColumns, SheetRow } from "../types/type";
import { loadSheetConfig } from "./sheetConfigLoader";
import { getSheetPrompt } from "./promptLoader";
import { judgeResponse } from "./ai";
import { ExternalServiceError } from "../errors";
import { env } from "../config/env";

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
    if (sheetsClient) return sheetsClient;

    const clientEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
    const privateKey = (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    return sheetsClient;
}

export async function appendRowToSheet(row: ResultRow) {
    const sheets = getSheetsClient();
    const sheetId = env.GOOGLE_SHEET_ID!;
    const sheetName = env.GOOGLE_SHEET_NAME;
    const range = buildSheetRange(sheetName, 'A:A');

    await ensureSheetExists(sheets, sheetId, sheetName);

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range,
    });

    const currentRow = (response.data.values?.length || 0) + 1;
    const values = await processResponseForSheet([row], currentRow);

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });
        console.log(`[SHEET:${sheetName}] Q${row.id} appended (row ${currentRow})`);
    } catch (error) {
        const serviceError = new ExternalServiceError(
            'Failed to append row to Google Sheet',
            'Google Sheets',
            error
        );
        console.error(`[${serviceError.code}] ${serviceError.message}`, serviceError.context);
    }
}

async function ensureSheetExists(sheets: sheets_v4.Sheets, spreadsheetId: string, sheetName: string) {
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(title))',
    });

    const exists = spreadsheet.data.sheets?.some((sheet) => sheet.properties?.title === sheetName);
    if (exists) return;

    const addResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                {
                    addSheet: {
                        properties: {
                            title: sheetName,
                        },
                    },
                },
            ],
        },
    });

    const newSheetId = addResponse.data.replies?.[0]?.addSheet?.properties?.sheetId;

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: buildSheetRange(sheetName, 'A1:O1'),
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [getSheetHeaders()],
        },
    });

    const { wrapColumns } = loadSheetConfig();
    if (newSheetId !== undefined && newSheetId !== null && wrapColumns.length > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: wrapColumns.map((key) => {
                    const columnIndex = key.charCodeAt(0) - 'A'.charCodeAt(0);
                    return {
                        repeatCell: {
                            range: {
                                sheetId: newSheetId,
                                startColumnIndex: columnIndex,
                                endColumnIndex: columnIndex + 1,
                            },
                            cell: {
                                userEnteredFormat: { wrapStrategy: 'WRAP' },
                            },
                            fields: 'userEnteredFormat.wrapStrategy',
                        },
                    };
                }),
            },
        });
    }

    console.log(`[SHEET:${sheetName}] created`);
}

function getSheetHeaders(): string[] {
    return Object.keys(SheetColumns).map((key) => SheetColumns[key as keyof typeof SheetColumns]);
}

function buildSheetRange(sheetName: string, range: string): string {
    const escapedSheetName = sheetName.replace(/'/g, "''");
    return `'${escapedSheetName}'!${range}`;
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
            entity: r.entity ?? '',
            todayCard: r.todayCard ?? '',
            card: r.card ?? '',
        };

        return Object.keys(SheetColumns).map((key) => rowData[SheetColumns[key as keyof typeof SheetColumns] as keyof SheetRow]);
    });

    // 모든 Promise가 해결될 때까지 기다림
    const values = await Promise.all(promises);
    return values;
}
