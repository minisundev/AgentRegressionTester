import axios, { type AxiosInstance } from 'axios';
import { createTestClient, buildRequestBody } from '../client/Client';
import { AgentResponse, ResultRow, TestCase } from '../types/type';
import { handleError, handleSuccess } from './resultHandlers';
import { getCaseAccountId } from '../utils/accountId';

const client = createTestClient();

export async function run(
  groupName: string,
  tc: TestCase,
  client: AxiosInstance,
  successes: ResultRow[],
  failures: ResultRow[]
) {
  const accountId = getCaseAccountId(groupName, tc);
  const body = buildRequestBody(tc.message, tc.agentType, tc.mainIntent, tc.subIntent, accountId);
  const start = Date.now();

  try {
    const { data } = await client.post<AgentResponse>('', body);
    const end = Date.now() - start;
    handleSuccess(groupName, tc, data, successes, end);
  } catch (err) {
    const end = Date.now() - start;
    handleError(groupName, err, tc, body, failures, end);
    throw err;
  }
}
