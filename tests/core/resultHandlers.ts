import axios from 'axios';
import { buildRequestBody } from '../client/Client';
import { AgentResponse, ResultRow, TestCase } from '../types/type';

export function handleSuccess(
  groupName: string,
  tc: TestCase,
  data: AgentResponse,
  successes: ResultRow[],
  time: number
) {
  const errors: string[] = [];
  console.log(JSON.stringify(data, null, 2))

  if (data.resultCode !== 200) {
    errors.push(`resultCode mismatch: ${data.resultCode}`);
  }

  if (data.response.mainIntent !== tc.mainIntent) {
    errors.push(
      `mainIntent mismatch: ${data.response.mainIntent}`,
    );
  }

  if (errors.length > 0) {
    successes.push({
      group: groupName,
      id: tc.id,
      request: data.requestMessage,
      response: data.response.message,
      mainIntent: data.response.mainIntent,
      subIntent: data.response.subIntent,
      reason: errors.join('; '),
      time: time,
    });
    return;
  }

  successes.push({
    group: groupName,
    id: tc.id,
    request: data.requestMessage,
    response: data.response.message,
    mainIntent: data.response.mainIntent,
    subIntent: data.response.subIntent,
    time: time,
  });
}


export function handleError(
  groupName: string,
  err: unknown,
  tc: TestCase,
  body: ReturnType<typeof buildRequestBody>,
  failures: ResultRow[],
  time: number
) {
  if (axios.isAxiosError(err) && err.response) {
    failures.push({
      group: groupName,
      id: tc.id,
      request: body.requestMessage,
      response: `[ERROR ${err.response.status}]`,
      reason: `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`,
      time: time
    });
  } else {
    failures.push({
      group: groupName,
      id: tc.id,
      request: body.requestMessage,
      response: `[UNKNOWN ERROR]`,
      reason: String(err),
      time: time
    });
  }
}