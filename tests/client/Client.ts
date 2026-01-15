import axios, { AxiosInstance } from 'axios';
import 'dotenv/config';

export const createTestClient = () : AxiosInstance => {
  const BASE_URL =
    process.env.CONTROL_BASE_URL;

  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Content-Type': 'application/json',
      'deviceId': process.env.DEVICE_ID||'default-device-id',
      'osapptype': process.env.OS_APP_TYPE||'android',
      'osappversion': process.env.OS_APP_VERSION||'1.0.0',
      'accept-language': process.env.ACCEPT_LANGUAGE||'vi',
      'traceId': process.env.TRACE_ID||'default-trace-id',
      'x-api-key': process.env.X_API_KEY,
    },
    timeout: 20000,
  });
};

export const buildRequestBody = (message: string, agent?:string, mainIntent?: string, subIntent?: string) => {
  return {
    accountId: process.env.ACCOUNT_ID,
    agentVersion: process.env.AGENT_VERSION,
    transactionId: 'test-' + Date.now(),
    agentType: agent,
    mainIntent: mainIntent,
    subIntent: subIntent,
    requestMessage: message,
    language: process.env.LANGUAGE || 'vietnamese',
  };
};
