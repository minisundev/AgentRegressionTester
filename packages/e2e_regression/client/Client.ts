import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';

export const createTestClient = () : AxiosInstance => {
  return axios.create({
    baseURL: env.CONTROL_BASE_URL,
    headers: {
      'Content-Type': 'application/json',
      'deviceId': env.DEVICE_ID,
      'osapptype': env.OS_APP_TYPE,
      'osappversion': env.OS_APP_VERSION,
      'accept-language': env.ACCEPT_LANGUAGE,
      'traceId': env.TRACE_ID,
      'x-api-key': env.X_API_KEY,
    },
    timeout: 20000,
  });
};

const AGENT_CHAT_END_URL = env.CONTROL_BASE_URL.replace(/agentChat$/, 'agentChatEnd');

export const endAgentChat = async (
  client: AxiosInstance,
  body: ReturnType<typeof buildRequestBody>,
): Promise<void> => {
  try {
    await client.post(AGENT_CHAT_END_URL, body);
  } catch (err) {
    console.warn(`[agentChatEnd] tx=${body.transactionId} failed: ${String(err)}`);
  }
};

export const buildRequestBody = (
  message: string,
  agent?:string,
  mainIntent?: string,
  subIntent?: string,
  accountIdOverride?: string,
) => {
  const accountId = accountIdOverride ?? env.ACCOUNT_ID;
  const transactionId = `${accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    accountId,
    agentVersion: env.AGENT_VERSION,
    transactionId,
    agentType: agent,
    mainIntent: mainIntent,
    subIntent: subIntent,
    requestMessage: message,
    language: env.LANGUAGE,
  };
};
