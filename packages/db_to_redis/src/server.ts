import 'dotenv/config';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { syncCache, syncPrompt, syncLlm } from './utils';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8081;

async function start() {
  const fastify = Fastify({ logger: false });

  await fastify.register(swagger, {
    openapi: {
      info: { title: 'ds-aia-db-tools', description: 'DB → Redis 동기화 로컬 개발 도구', version: '1.0.0' },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
  });

  fastify.post<{
    Body: { type?: 'cache' | 'prompt' | 'llm'; key?: string };
  }>(
    '/dbToRedis',
    {
      schema: {
        description: 'DB 데이터를 Redis로 동기화합니다.',
        body: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['cache', 'prompt', 'llm'],
              description: '생략 시 cache + prompt 전체 동기화 (기존 키 삭제 포함)',
            },
            key: {
              type: 'string',
              description: 'type=cache: utter_text 값 / type=prompt: mainIntent:subIntent 값',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              cacheCount: { type: 'number' },
              promptCount: { type: 'number' },
              llmCount: { type: 'number' },
            },
          },
        },
      },
    },
    async (req) => {
      const { type, key } = req.body ?? {};
      let cacheCount = 0;
      let promptCount = 0;
      let llmCount = 0;

      if (type) {
        if (type === 'cache') cacheCount = await syncCache(key);
        else if (type === 'prompt') promptCount = await syncPrompt(key);
        else if (type === 'llm') llmCount = await syncLlm(key);
      } else {
        cacheCount = await syncCache(undefined, true);
        promptCount = await syncPrompt(undefined, true);
        llmCount = await syncLlm(undefined, true);
      }

      return { cacheCount, promptCount, llmCount };
    }
  );

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`\n[ds-aia-db-tools] server : http://localhost:${PORT}`);
  console.log(`[ds-aia-db-tools] swagger : http://localhost:${PORT}/docs\n`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
