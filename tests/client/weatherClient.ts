import axios, { AxiosInstance } from 'axios';
import 'dotenv/config';

export const createWeatherTestClient = () : AxiosInstance => {
  const BASE_URL =
    process.env.CONTROL_BASE_URL;

  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Content-Type': 'application/json',
      'deviceId': 'deviceld',
      'osapptype': 'android',
      'osappversion': '1.0.0',
      'accept-language': 'en',
      'traceId': 'traceId',
      'x-api-key': process.env.X_API_KEY,
    },
    timeout: 20000,
  });
};

export const buildWeatherRequestBody = (message: string, subIntent: string) => {
  return {
    accountId: 'devsun',
    agentVersion: '1.0.0',
    transactionId: 'test-' + Date.now(),
    agentType: 'DailyInfoAgent',
    mainIntent: 'Weather',
    subIntent: subIntent,
    requestMessage: message,
    language: 'english',
  };
};
