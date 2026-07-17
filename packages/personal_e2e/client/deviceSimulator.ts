import Redis from 'ioredis';
import { env } from '../config/env';
import { DeviceEvent, TurnMock } from '../types';

/**
 * 단말(디바이스) 역할 시뮬레이터.
 *
 * aia-personal 은 캘린더/알람/리마인더의 실제 데이터를 갖고 있지 않다.
 * 에이전트가 SSE EVENT(GET_COUNT / CHECK_DUPLICATE / GET_USER_QUERY)로
 * callbackId 를 내려주면, 단말이 Redis 채널 `callback:{callbackId}` 에
 * 결과를 publish 해줘야 그래프가 진행된다 (3초 안에 안 오면 AgentCallbackError).
 * 테스트에서는 이 클래스가 그 publish 를 대신한다.
 */
export class DeviceSimulator {
  private redis: Redis;

  constructor() {
    if (env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL);
    } else {
      this.redis = new Redis({
        // REDIS_ENDPOINT 에 redis:// 접두어가 붙어 있어도 host 로 쓸 수 있게 정리
        host: (env.REDIS_ENDPOINT ?? '127.0.0.1').replace(/^rediss?:\/\//, ''),
        port: env.REDIS_PORT ?? 6379,
        password: env.REDIS_PASSWD || undefined,
        tls: env.REDIS_SSL === 'true' ? {} : undefined,
      });
    }
  }

  buildPayload(eventCode: string, mock?: TurnMock): Record<string, unknown> {
    switch (eventCode) {
      case 'GET_COUNT':
        return { eventCode, totalCount: mock?.totalCount ?? 0 };
      case 'CHECK_DUPLICATE':
        return {
          eventCode,
          totalCount: mock?.totalCount ?? 0,
          duplicateCount: mock?.duplicateCount ?? 0,
        };
      case 'GET_USER_QUERY': {
        const list = mock?.list ?? [];
        return { eventCode, listCount: list.length, list };
      }
      default:
        return { eventCode };
    }
  }

  async respond(event: DeviceEvent, mock?: TurnMock): Promise<void> {
    const payload = this.buildPayload(event.eventCode, mock);
    await this.redis.publish(`callback:${event.callbackId}`, JSON.stringify(payload));
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
