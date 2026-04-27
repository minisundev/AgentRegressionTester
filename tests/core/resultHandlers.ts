import { ApiError } from '../errors';
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

  const entity = data.response.entity ? JSON.stringify(data.response.entity) : '';
  const todayCard = data.response.todayCard ? JSON.stringify(data.response.todayCard) : '';
  const card = data.response.weeklyCard
    ? JSON.stringify(data.response.weeklyCard)
    : data.response.hourlyCard
    ? JSON.stringify(data.response.hourlyCard)
    : '';

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
      entity,
      todayCard,
      card,
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
    entity,
    todayCard,
    card,
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
  if (ApiError.isAxiosError(err)) {
    const apiError = ApiError.fromAxiosError(err);
    failures.push({
      group: groupName,
      id: tc.id,
      request: body.requestMessage,
      response: `[ERROR ${apiError.statusCode}]`,
      mainIntent: tc.mainIntent,
      subIntent: tc.subIntent,
      reason: apiError.message,
      time: time
    });
  } else {
    failures.push({
      group: groupName,
      id: tc.id,
      request: body.requestMessage,
      response: `[UNKNOWN ERROR]`,
      mainIntent: tc.mainIntent,
      subIntent: tc.subIntent,
      reason: String(err),
      time: time
    });
  }
}
