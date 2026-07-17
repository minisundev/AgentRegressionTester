import axios from 'axios';
import type { Readable } from 'stream';
import { env, requireApiKey } from '../config/env';
import { DeviceEvent, PersonalLanguage, TurnResult } from '../types';

export interface PersonalRequestBody {
  accountId: string;
  agentVersion: string;
  transactionId: string;
  agentType: string; // PersonalAgent | PersonalConAgent
  // 1턴(라우팅용)에만 필수. 잠금 턴에서는 null — 서버가 대화 상태에서 복원한다.
  mainIntent: string | null;
  subIntent: string | null;
  requestMessage: string;
  language: PersonalLanguage;
  conversationId: string | null;
}

interface SseEvent {
  type: string;
  transactionId?: string;
  procTime?: number;
  message?: Record<string, any>;
}

export function buildPersonalBody(params: {
  accountId: string;
  agentType: string;
  mainIntent: string | null;
  subIntent: string | null;
  message: string;
  language: PersonalLanguage;
  conversationId: string | null;
}): PersonalRequestBody {
  return {
    accountId: params.accountId,
    agentVersion: env.AGENT_VERSION,
    transactionId: `${params.accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentType: params.agentType,
    mainIntent: params.mainIntent,
    subIntent: params.subIntent,
    requestMessage: params.message,
    language: params.language,
    conversationId: params.conversationId,
  };
}

/**
 * POST {PERSONAL_BASE_URL}/personalStream 을 호출해 SSE 를 끝까지 소비한다.
 *
 * 슬롯필링 프로토콜:
 *  - EVENT { eventCode: CONVERSATION_LOCK, conversationLock: Y|N, conversationId }
 *    → Y 면 다음 턴을 PersonalConAgent + 이 conversationId 로 보내야 한다.
 *  - EVENT { eventCode: GET_COUNT|CHECK_DUPLICATE|GET_USER_QUERY, callbackId }
 *    → 단말 콜백 요구. onDeviceEvent 로 즉시 응답(publish)해야 3초 타임아웃을 넘긴다.
 *  - DATA { slot_complete: Y|N, entity, card_show }
 *  - TOKEN { token } → 사용자에게 보이는 응답 문장.
 *  - END_SRV { resultCode, resultMessage } → 스트림 종료.
 */
export async function runPersonalStream(
  body: PersonalRequestBody,
  language: PersonalLanguage,
  onDeviceEvent: (event: DeviceEvent) => Promise<void>,
): Promise<Omit<TurnResult, 'turnIndex' | 'agentType' | 'mainIntent' | 'subIntent' | 'request' | 'checkFailures'>> {
  const start = Date.now();
  const acceptLanguage = language === 'english' ? 'en' : 'vi';

  const res = await axios.post<Readable>(`${env.PERSONAL_BASE_URL}/personalStream`, body, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'deviceId': env.DEVICE_ID,
      'osapptype': env.OS_APP_TYPE,
      'osappversion': env.OS_APP_VERSION,
      'accept-language': acceptLanguage,
      'traceId': env.TRACE_ID,
      'x-api-key': requireApiKey(),
      'x-req-time': String(Date.now()),
    },
    responseType: 'stream',
    timeout: env.PERSONAL_TURN_TIMEOUT_SEC * 1000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  let messageText = '';
  let tokenCount = 0;
  let ttft: number | undefined;
  let resultCode = 0;
  let resultMessage = '';
  let entity: Record<string, unknown> | undefined;
  let slotComplete: string | undefined;
  let cardShow: string | undefined;
  let conversationLock: 'Y' | 'N' | null = null;
  let conversationId: string | null = null;
  let serverMainIntent: string | undefined;
  let serverSubIntent: string | undefined;
  const deviceEvents: DeviceEvent[] = [];
  // 콜백 publish 가 SSE 소비를 막지 않도록 비동기로 쌓고 마지막에 기다린다.
  const pendingCallbacks: Promise<void>[] = [];

  const handleEvent = (event: SseEvent) => {
    const msg = event.message ?? {};
    switch (event.type) {
      case 'INTENT':
        // 멀티턴이면 서버가 대화 상태에서 복원한 인텐트를 내려준다.
        if (typeof msg.mainIntent === 'string') serverMainIntent = msg.mainIntent;
        if (typeof msg.subIntent === 'string') serverSubIntent = msg.subIntent;
        break;
      case 'TOKEN':
        if (typeof msg.token === 'string') {
          if (tokenCount === 0) ttft = Date.now() - start;
          messageText += msg.token;
          tokenCount += 1;
        }
        break;
      case 'DATA':
        if (typeof msg.slot_complete === 'string') slotComplete = msg.slot_complete;
        if (typeof msg.card_show === 'string') cardShow = msg.card_show;
        if (msg.entity && typeof msg.entity === 'object') {
          entity = { ...(entity ?? {}), ...msg.entity };
        }
        break;
      case 'EVENT': {
        const eventCode = String(msg.eventCode ?? '');
        if (eventCode === 'CONVERSATION_LOCK') {
          // 한 턴 안에서 Y 후 N 이 올 수 있다 — 항상 마지막 수신값이 기준.
          conversationLock = msg.conversationLock === 'Y' ? 'Y' : 'N';
          conversationId = typeof msg.conversationId === 'string' ? msg.conversationId : null;
        } else if (typeof msg.callbackId === 'string') {
          const deviceEvent: DeviceEvent = {
            eventCode,
            callbackId: msg.callbackId,
            entity: msg.entity,
          };
          deviceEvents.push(deviceEvent);
          pendingCallbacks.push(onDeviceEvent(deviceEvent));
        }
        break;
      }
      case 'END_SRV':
        if (typeof msg.resultCode === 'number') resultCode = msg.resultCode;
        if (typeof msg.resultMessage === 'string') resultMessage = msg.resultMessage;
        break;
      default:
        // START_SRV / SUGGESTION / NODE_LOG 는 리포트에 불필요.
        break;
    }
  };

  await consumeSse(res.data, handleEvent);
  await Promise.all(pendingCallbacks);

  return {
    resultCode,
    resultMessage,
    serverMainIntent,
    serverSubIntent,
    messageText,
    entity,
    slotComplete,
    cardShow,
    conversationLock,
    conversationId,
    deviceEvents,
    ttft,
    tokenCount,
    totalTime: Date.now() - start,
  };
}

async function consumeSse(stream: Readable, onEvent: (event: SseEvent) => void): Promise<void> {
  let buffer = '';

  const flushLine = (rawLine: string) => {
    const line = rawLine.trim();
    // `event: XXX` 라인은 무시 — data JSON 안의 type 으로 분기한다.
    if (!line || !line.startsWith('data:')) return;
    const payload = line.slice('data:'.length).trim();
    if (!payload) return;
    try {
      onEvent(JSON.parse(payload) as SseEvent);
    } catch {
      // keep-alive / partial line 무시
    }
  };

  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      flushLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  }
  if (buffer) flushLine(buffer);
}
