import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // 테스트 파일 위치
  testMatch: ['**/tests/**/*.spec.ts'],

  // 로그 너무 길어지면 테스트 찾기 어려우니 false로 할까 하다가 그냥 true로 둠
  verbose: true,
  
  // 프로젝트 경로
  moduleDirectories: ['node_modules', 'src'],

  testTimeout: 15000,
};

export default config;
