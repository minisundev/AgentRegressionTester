import fs from 'fs';
import path from 'path';
import Table from 'cli-table3';
import { env } from '../config/env';
import { loadCaseGroups } from '../loadCases';
import { DeviceSimulator } from '../client/deviceSimulator';
import { buildPersonalBody, runPersonalStream } from '../client/personalStreamClient';
import { CaseResult, PersonalCase, TurnResult } from '../types';
import { runTurnChecks } from '../checks';
import { appendCaseToSheet, sheetReportEnabled } from '../utils/sheetReporter';

// 케이스 = 하나의 대화. 턴을 순서대로 보내면서
//  - 이전 턴이 CONVERSATION_LOCK(Y) 를 내렸으면 PersonalConAgent + conversationId 로,
//  - 아니면 PersonalAgent + 그 턴의 mainIntent/subIntent 로 보낸다.
// STM(chat history)이 accountId 해시로 Redis 에 남으므로 케이스마다 고유 accountId 를 쓴다.
async function runCase(
  group: string,
  tc: PersonalCase,
  device: DeviceSimulator,
): Promise<CaseResult> {
  const language = tc.language ?? env.PERSONAL_LANGUAGE;
  const accountId = `${env.ACCOUNT_ID}-${tc.id}-${Date.now().toString(36)}`;
  const turns: TurnResult[] = [];
  let conversationId: string | null = null;

  for (const [i, turn] of tc.turns.entries()) {
    const locked: boolean = conversationId !== null;
    const agentType: string = locked ? 'PersonalConAgent' : 'PersonalAgent';

    const sendOnce = (): ReturnType<typeof runPersonalStream> =>
      runPersonalStream(
        buildPersonalBody({
          accountId,
          agentType,
          // 잠금 턴은 Personal/Conversation 고정 — conv_route 가 이 값으로
          // conv_Personal_{Conversation|List|Confirm}.yaml 프롬프트를 연다.
          // (실제 인텐트는 서버가 대화 상태에서 복원해 INTENT 프레임으로 알려줌)
          mainIntent: locked ? 'Personal' : turn.mainIntent,
          subIntent: locked ? 'Conversation' : turn.subIntent,
          message: turn.message,
          language,
          conversationId,
        }),
        language,
        (event) => device.respond(event, turn.mock),
      );

    const base = {
      turnIndex: i + 1,
      request: turn.message,
      agentType,
      mainIntent: turn.mainIntent,
      subIntent: turn.subIntent,
    };

    try {
      let result = await sendOnce();
      if (result.resultCode === 364408) {
        console.log('     (364408 LLM Adaptor Error — 1회 재시도)');
        result = await sendOnce();
      }
      const checkFailures = runTurnChecks(turn, result.messageText, result.entity, language);
      turns.push({ ...base, ...result, checkFailures });

      if (result.conversationLock === 'Y' && result.conversationId) {
        conversationId = result.conversationId;
      } else if (result.conversationLock === 'N') {
        conversationId = null;
      }
      // 상태머신 리셋: 364404(Invalid Conversation)/364405(Unsupported)/364407(History State) 등
      // 에러로 끝난 턴의 conversationId 는 재사용 금지 → IDLE 로 복귀해 다음 턴 진행.
      if (result.resultCode !== 200) {
        conversationId = null;
      }
    } catch (err) {
      turns.push({
        ...base,
        resultCode: -1,
        resultMessage: '',
        messageText: '',
        conversationLock: null,
        conversationId: null,
        deviceEvents: [],
        tokenCount: 0,
        totalTime: 0,
        checkFailures: [],
        error: err instanceof Error ? err.message : String(err),
      });
      break; // 대화가 깨졌으니 남은 턴은 의미 없음
    }
  }

  const pass = turns.length === tc.turns.length
    && turns.every((t) => t.resultCode === 200 && !t.error && t.checkFailures.length === 0);
  return { group, id: tc.id, name: tc.name, turns, pass };
}

function printTurn(t: TurnResult): void {
  const lock = t.conversationLock === 'Y' ? ` [LOCK ${t.conversationId}]` : t.conversationLock === 'N' ? ' [UNLOCK]' : '';
  const events = t.deviceEvents.length ? ` events=${t.deviceEvents.map((e) => e.eventCode).join(',')}` : '';
  const restored = t.serverMainIntent ? ` restored=${t.serverMainIntent}/${t.serverSubIntent ?? '?'}` : '';
  console.log(`  ── turn ${t.turnIndex} (${t.agentType} ${t.mainIntent}/${t.subIntent})${restored}${lock}${events}`);
  console.log(`     Q: ${t.request.replace(/\n/g, ' / ')}`);
  if (t.error) {
    console.log(`     !! ERROR: ${t.error}`);
    return;
  }
  console.log(`     A: ${t.messageText.replace(/\n/g, ' ')}`);
  const meta: string[] = [`resultCode=${t.resultCode}`, `${t.totalTime}ms`];
  if (t.resultCode !== 200 && t.resultMessage) meta.push(`resultMessage=${t.resultMessage}`);
  if (t.slotComplete !== undefined) meta.push(`slot_complete=${t.slotComplete}`);
  if (t.ttft !== undefined) meta.push(`ttft=${t.ttft}ms`);
  console.log(`     ${meta.join(' | ')}`);
  if (t.entity) console.log(`     entity: ${JSON.stringify(t.entity)}`);
  for (const failure of t.checkFailures) console.log(`     ✘ check: ${failure}`);
}

async function main(): Promise<void> {
  const groups = loadCaseGroups();
  const totalCases = groups.reduce((sum, g) => sum + g.cases.length, 0);
  console.log(`[personal_e2e] ${env.PERSONAL_BASE_URL} 대상, ${totalCases} case(s)`);

  const device = new DeviceSimulator();
  const results: CaseResult[] = [];
  const toSheet = sheetReportEnabled();
  if (toSheet) console.log(`[personal_e2e] sheet report → ${env.PERSONAL_SHEET_NAME}`);

  try {
    for (const group of groups) {
      for (const tc of group.cases) {
        console.log(`\n▶ [${group.groupName}] #${tc.id} ${tc.name}`);
        const result = await runCase(group.groupName, tc, device);
        result.turns.forEach(printTurn);
        console.log(result.pass ? '  ✔ PASS' : '  ✘ FAIL');
        results.push(result);
        if (toSheet) await appendCaseToSheet(result);
      }
    }
  } finally {
    await device.close();
  }

  // 요약
  const table = new Table({ head: ['group', 'id', 'name', 'turns', 'result'] });
  for (const r of results) {
    table.push([r.group, String(r.id), r.name.slice(0, 48), String(r.turns.length), r.pass ? 'PASS' : 'FAIL']);
  }
  console.log(`\n${table.toString()}`);
  const failCount = results.filter((r) => !r.pass).length;
  console.log(`total=${results.length} pass=${results.length - failCount} fail=${failCount}`);

  if (env.PERSONAL_RESULT_JSON_PATH) {
    const resultPath = path.resolve(env.PERSONAL_RESULT_JSON_PATH);
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify({ finishedAt: new Date().toISOString(), results }, null, 2), 'utf8');
    console.log(`[personal_e2e] results written to ${resultPath}`);
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[personal_e2e] fatal:', err);
  process.exit(1);
});
