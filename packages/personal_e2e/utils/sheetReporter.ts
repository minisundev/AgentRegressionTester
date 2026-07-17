import { google, sheets_v4 } from 'googleapis';
import { env } from '../config/env';
import { CaseResult, TurnResult } from '../types';

// weather e2e 와 같은 서비스 계정(GOOGLE_*)을 재사용하는 경량 시트 리포터.
// 케이스 단위로 턴 행들을 한 번에 append 한다 (judge/번역 없음).

const HEADERS = [
  'testedAt',
  'group',
  'caseId',
  'caseName',
  'turn',
  'agentType',
  'reqIntent',
  'restoredIntent',
  'request',
  'response',
  'entity',
  'slot_complete',
  'lock',
  'events',
  'resultCode',
  'resultMessage',
  'checkFailures',
  'turnResult',
  'caseResult',
  'time(ms)',
  'ttft(ms)',
] as const;

let sheetsClient: sheets_v4.Sheets | null = null;
let headerSynced = false;

function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    key: (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export function sheetReportEnabled(): boolean {
  if (env.PERSONAL_REPORT_TO !== 'sheet') return false;
  if (!env.GOOGLE_SHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    console.warn('[personal_e2e] PERSONAL_REPORT_TO=sheet 이지만 GOOGLE_* 설정이 없어 terminal 로 fallback');
    return false;
  }
  return true;
}

async function ensureSheet(sheets: sheets_v4.Sheets): Promise<void> {
  const spreadsheetId = env.GOOGLE_SHEET_ID!;
  const title = env.PERSONAL_SHEET_NAME;

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  });
  const exists = spreadsheet.data.sheets?.some((s) => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
  if (!headerSynced) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${title}'!A1:${String.fromCharCode(64 + HEADERS.length)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[...HEADERS]] },
    });
    headerSynced = true;
  }
}

function turnToRow(result: CaseResult, t: TurnResult, testedAt: string): (string | number)[] {
  const lock = t.conversationLock === 'Y'
    ? `Y ${t.conversationId ?? ''}`
    : t.conversationLock === 'N' ? 'N' : '';
  return [
    testedAt,
    result.group,
    String(result.id),
    result.name,
    `${t.turnIndex}/${result.turns.length}`,
    t.agentType,
    `${t.mainIntent}/${t.subIntent}`,
    t.serverMainIntent ? `${t.serverMainIntent}/${t.serverSubIntent ?? ''}` : '',
    t.request,
    t.error ? `[ERROR] ${t.error}` : t.messageText,
    t.entity ? JSON.stringify(t.entity) : '',
    t.slotComplete ?? '',
    lock,
    t.deviceEvents.map((e) => e.eventCode).join(','),
    t.resultCode,
    t.resultMessage,
    t.checkFailures.join(' | '),
    t.resultCode === 200 && !t.error && t.checkFailures.length === 0 ? 'PASS' : 'FAIL',
    result.pass ? 'PASS' : 'FAIL',
    t.totalTime,
    t.ttft ?? '',
  ];
}

export async function appendCaseToSheet(result: CaseResult): Promise<void> {
  try {
    const sheets = getSheetsClient();
    await ensureSheet(sheets);
    const testedAt = new Date().toISOString();
    const values = result.turns.map((t) => turnToRow(result, t, testedAt));
    await sheets.spreadsheets.values.append({
      spreadsheetId: env.GOOGLE_SHEET_ID!,
      range: `'${env.PERSONAL_SHEET_NAME}'!A:A`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
    console.log(`  [SHEET:${env.PERSONAL_SHEET_NAME}] #${result.id} ${values.length} row(s) appended`);
  } catch (err) {
    // 시트 실패로 테스트 런 자체를 죽이지 않는다.
    console.error(`  [SHEET] append failed for #${result.id}:`, err instanceof Error ? err.message : err);
  }
}
