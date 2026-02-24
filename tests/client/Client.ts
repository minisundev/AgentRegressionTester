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

export const buildRequestBody = (message: string, agent?:string, mainIntent?: string, subIntent?: string) => {
  return {
    accountId: env.ACCOUNT_ID,
    agentVersion: env.AGENT_VERSION,
    transactionId: 'test-' + Date.now(),
    agentType: agent,
    mainIntent: mainIntent,
    subIntent: subIntent,
    requestMessage: message,
    language: env.LANGUAGE,
  };
};
