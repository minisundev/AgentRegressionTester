import axios from 'axios';
import type { Readable } from 'stream';
import { env } from '../config/env';
import { buildRequestBody } from './Client';
import { AgentResponse, StreamEvent, StreamMetrics } from '../types/type';

// The streaming endpoint mirrors agentChat but emits Server-Sent Events.
// e.g. .../v1/agentChat -> .../v1/agentChatStream
export const STREAM_URL = env.CONTROL_BASE_URL.replace(/agentChat$/, 'agentChatStream');

const STREAM_TIMEOUT_MS = 120_000;

function streamHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    'deviceId': env.DEVICE_ID,
    'osapptype': env.OS_APP_TYPE,
    'osappversion': env.OS_APP_VERSION,
    'accept-language': env.ACCEPT_LANGUAGE,
    'traceId': env.TRACE_ID,
    'x-api-key': env.X_API_KEY,
  };
}

export interface StreamResult {
  data: AgentResponse;
  metrics: StreamMetrics;
}

/**
 * POSTs a request to the agentChatStream endpoint, consumes the SSE stream,
 * and reassembles it into the same AgentResponse shape returned by agentChat
 * so the existing validation / sheet pipeline can be reused.
 */
export async function runAgentChatStream(
  body: ReturnType<typeof buildRequestBody>,
): Promise<StreamResult> {
  const start = Date.now();

  const res = await axios.post<Readable>(STREAM_URL, body, {
    headers: streamHeaders(),
    responseType: 'stream',
    timeout: STREAM_TIMEOUT_MS,
    // SSE never resolves the body up-front; let jest's timeout be the upper bound.
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  let tokenText = '';
  let tokenCount = 0;
  let ttft: number | undefined;

  let requestMessage = body.requestMessage;
  let mainIntent = '';
  let subIntent = '';
  let resultCode = 0;
  let dataMessage: Record<string, unknown> = {};

  const handleEvent = (event: StreamEvent) => {
    const msg = event.message ?? {};

    // Structured response fields are not guaranteed to arrive only in DATA.
    // In particular, validation/error paths may attach the parsed entity to
    // INTENT or END. Preserve them regardless of the SSE event type.
    for (const key of ['entity', 'todayCard', 'hourlyCard', 'weeklyCard'] as const) {
      const value = parseRecord(msg[key]);
      if (value) dataMessage[key] = value;
    }
    if (typeof msg.resultCode === 'number') resultCode = msg.resultCode;

    switch (event.type) {
      case 'START':
        if (typeof msg.requestMessage === 'string') requestMessage = msg.requestMessage;
        break;
      case 'INTENT':
        if (typeof msg.mainIntent === 'string') mainIntent = msg.mainIntent;
        if (typeof msg.subIntent === 'string') subIntent = msg.subIntent;
        if (typeof msg.requestMessage === 'string') requestMessage = msg.requestMessage;
        break;
      case 'DATA': {
        // Carries todayCard / weeklyCard / hourlyCard / entity, etc.
        const { requestMessage: _ignored, ...rest } = msg;
        dataMessage = { ...dataMessage, ...rest };
        break;
      }
      case 'TOKEN':
        if (typeof msg.token === 'string') {
          if (tokenCount === 0) ttft = Date.now() - start;
          tokenText += msg.token;
          tokenCount += 1;
        }
        break;
      case 'END':
        if (typeof msg.resultCode === 'number') resultCode = msg.resultCode;
        break;
      default:
        // START_SRV / END_SRV / SUGGESTION and any future events are ignored.
        break;
    }
  };

  await consumeSse(res.data, handleEvent);

  const totalTime = Date.now() - start;

  const response = {
    message: tokenText,
    mainIntent,
    subIntent,
    ttsText: tokenText,
    ...dataMessage,
  } as AgentResponse['response'];

  const data: AgentResponse = {
    resultCode,
    requestMessage,
    response,
  };

  return { data, metrics: { ttft, tokenCount, totalTime } };
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

async function consumeSse(stream: Readable, onEvent: (event: StreamEvent) => void): Promise<void> {
  let buffer = '';

  const flushLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || !line.startsWith('data:')) return;

    const payload = line.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') return;

    try {
      onEvent(JSON.parse(payload) as StreamEvent);
    } catch {
      // Ignore partial / non-JSON keep-alive lines.
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
