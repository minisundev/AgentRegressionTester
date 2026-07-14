import type { Config } from 'jest';
import 'dotenv/config';

const configuredConcurrency = Number(process.env.PARALLEL_ACCOUNT_COUNT ?? '5');

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // 테스트 파일 위치
  testMatch: ['**/packages/e2e_regression/**/*.spec.ts'],

  // 로그 너무 길어지면 테스트 찾기 어려우니 false로 할까 하다가 그냥 true로 둠
  verbose: true,
  
  // 프로젝트 경로
  moduleDirectories: ['node_modules', 'packages/model_payload_test'],

  // model_payload_test는 NodeNext식 `.js` 확장자 import를 쓰는데, e2e_regression이
  // 이를 ts-jest(commonjs)로 끌어쓰면 `.js`를 못 푼다. 상대경로 `.js`를 스트립해
  // 실제 `.ts` 소스로 해석되게 한다.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  testTimeout: 15000,
  maxConcurrency: Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
    ? configuredConcurrency
    : 5,
};

export default config;
