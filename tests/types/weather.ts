export interface WeatherTestCase {
  id: string | number;
  name: string;
  message: string;
  subIntent: string;
}

export interface AgentResponse {
  resultCode: number;
  requestMessage: string;
  response: {
    message: string;
    
    mainIntent: string;
    subIntent: string;
    ttsText: string;
  };
}

export interface WeatherResultRow {
  group: string,
  id: number | string;
  request: string;
  response: string;
  reason?: string;
  mainIntent?: string;
  subIntent?: string;
  tts?:string;
  time: number;
}