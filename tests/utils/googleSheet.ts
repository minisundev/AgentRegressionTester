import { google, sheets_v4 } from "googleapis";
import { JudgeMode, ResultRow, SheetColumns, SheetRow } from "../types/type";
import { loadSheetConfig } from "./sheetConfigLoader";
import { getSheetPrompt } from "./promptLoader";
import { judgeResponse } from "./ai";
import { ExternalServiceError } from "../errors";
import { env } from "../config/env";
import { shouldUseGptResponseTranslation, translateResponseWithGpt } from "./responseTranslator";
import { withNetworkRetry } from "./networkRetry";

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

export async function appendRowToSheet(row: ResultRow): Promise<number | undefined> {
    const sheets = getSheetsClient();
    const sheetId = env.GOOGLE_SHEET_ID!;
    const sheetName = env.GOOGLE_SHEET_NAME;
    const range = buildSheetRange(sheetName, 'A:A');

    const sheetTabId = await withNetworkRetry(
        () => ensureSheetExists(sheets, sheetId, sheetName),
        { label: `sheet:ensure:${sheetName}` },
    );

    const response = await withNetworkRetry(
        () => sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range }),
        { label: `sheet:get:${sheetName}` },
    );

    const currentRow = (response.data.values?.length || 0) + 1;
    const values = await processResponseForSheet([row], currentRow);

    try {
        await withNetworkRetry(
            () => sheets.spreadsheets.values.append({
                spreadsheetId: sheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            }),
            { label: `sheet:append:${sheetName}` },
        );
        if (row.isMultiTurn && sheetTabId !== undefined) {
            try {
                await highlightMultiTurnRow(sheets, sheetId, sheetTabId, currentRow);
            } catch (highlightError) {
                const message = highlightError instanceof Error ? highlightError.message : String(highlightError);
                console.warn(`[SHEET:${sheetName}] failed to highlight multi-turn row ${currentRow}: ${message}`);
            }
        }
        console.log(`[SHEET:${sheetName}] Q${row.id} appended (row ${currentRow})`);
        return currentRow;
    } catch (error) {
        const serviceError = new ExternalServiceError(
            'Failed to append row to Google Sheet',
            'Google Sheets',
            error
        );
        console.error(`[${serviceError.code}] ${serviceError.message}`, serviceError.context);
        return undefined;
    }
}

export async function updateRowInSheet(row: ResultRow, rowNumber: number): Promise<boolean> {
    const sheets = getSheetsClient();
    const sheetId = env.GOOGLE_SHEET_ID!;
    const sheetName = env.GOOGLE_SHEET_NAME;
    const lastColumn = lastSheetColumn();
    const range = buildSheetRange(sheetName, `A${rowNumber}:${lastColumn}${rowNumber}`);

    const sheetTabId = await withNetworkRetry(
        () => ensureSheetExists(sheets, sheetId, sheetName),
        { label: `sheet:ensure:${sheetName}` },
    );

    const values = await processResponseForSheet([row], rowNumber);

    try {
        await withNetworkRetry(
            () => sheets.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            }),
            { label: `sheet:update:${sheetName}:row${rowNumber}` },
        );
        if (row.isMultiTurn && sheetTabId !== undefined) {
            try {
                await highlightMultiTurnRow(sheets, sheetId, sheetTabId, rowNumber);
            } catch (highlightError) {
                const message = highlightError instanceof Error ? highlightError.message : String(highlightError);
                console.warn(`[SHEET:${sheetName}] failed to highlight multi-turn row ${rowNumber}: ${message}`);
            }
        }
        console.log(`[SHEET:${sheetName}] Q${row.id} updated (row ${rowNumber})`);
        return true;
    } catch (error) {
        const serviceError = new ExternalServiceError(
            'Failed to update row in Google Sheet',
            'Google Sheets',
            error
        );
        console.error(`[${serviceError.code}] ${serviceError.message}`, serviceError.context);
        return false;
    }
}

async function ensureSheetExists(sheets: sheets_v4.Sheets, spreadsheetId: string, sheetName: string): Promise<number | undefined> {
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))',
    });

    const existingSheet = spreadsheet.data.sheets?.find((sheet) => sheet.properties?.title === sheetName);
    if (existingSheet) return existingSheet.properties?.sheetId ?? undefined;

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
        range: buildSheetRange(sheetName, `A1:${lastSheetColumn()}1`),
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
    return newSheetId ?? undefined;
}

async function highlightMultiTurnRow(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetId: number,
    rowNumber: number,
) {
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                {
                    repeatCell: {
                        range: {
                            sheetId,
                            startRowIndex: rowNumber - 1,
                            endRowIndex: rowNumber,
                            startColumnIndex: 0,
                            endColumnIndex: Object.keys(SheetColumns).length,
                        },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: {
                                    red: 0.85,
                                    green: 0.92,
                                    blue: 0.83,
                                },
                            },
                        },
                        fields: 'userEnteredFormat.backgroundColor',
                    },
                },
            ],
        },
    });
}

function getSheetHeaders(): string[] {
    return Object.keys(SheetColumns).map((key) => SheetColumns[key as keyof typeof SheetColumns]);
}

function lastSheetColumn(): string {
    return String.fromCharCode('A'.charCodeAt(0) + Object.keys(SheetColumns).length - 1);
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

function getRequestTranslation(row: ResultRow, currentRow: number): string {
    const translation = row.reqTranslation?.trim();
    if (translation) return translation;

    return `=GOOGLETRANSLATE(E${currentRow}, "${env.GOOGLETRANSLATE_SOURCE_LANGUAGE}", "${env.GOOGLETRANSLATE_TARGET_LANGUAGE}")`;
}

function getResponseTranslationFormula(currentRow: number): string {
    return `=GOOGLETRANSLATE(F${currentRow}, "${env.GOOGLETRANSLATE_SOURCE_LANGUAGE}", "${env.GOOGLETRANSLATE_TARGET_LANGUAGE}")`;
}

async function getResponseTranslation(response: string, currentRow: number): Promise<string> {
    if (!shouldUseGptResponseTranslation()) {
        return getResponseTranslationFormula(currentRow);
    }

    try {
        const translation = await translateResponseWithGpt(response);
        return translation || getResponseTranslationFormula(currentRow);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[SHEET:${env.GOOGLE_SHEET_NAME}] GPT response translation failed at row ${currentRow}: ${message}`);
        return getResponseTranslationFormula(currentRow);
    }
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
            reqTranslation: getRequestTranslation(r, currentRow),
            resTranslation: await getResponseTranslation(cleanResponse, currentRow),
            judge: await judgeResponse(prompt, r.request ?? '', cleanResponse, currentRow),
            time: r.time ?? 0,
            reason: r.reason ?? '',
            testedAt: new Date().toISOString(),
            entity: r.entity ?? '',
            todayCard: r.todayCard ?? '',
            card: r.card ?? '',
            mode: r.mode ?? '',
            ttft: r.ttft ?? '',
            tokenCount: r.tokenCount ?? '',
        };

        return Object.keys(SheetColumns).map((key) => rowData[SheetColumns[key as keyof typeof SheetColumns] as keyof SheetRow]);
    });

    // 모든 Promise가 해결될 때까지 기다림
    const values = await Promise.all(promises);
    return values;
}
