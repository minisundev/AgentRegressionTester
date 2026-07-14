import 'dotenv/config';
import fs from 'fs';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { syncPrompts, getStatus } from './sync';
import { getPromptsDir } from './manifest';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8083;

async function start() {
  const fastify = Fastify({ logger: false });

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'prompt-update',
        description: '로컬 prompts/*.md → Redis llm_prompt 동기화 도구 (db_to_redis prompt sync 대체)',
        version: '1.0.0',
      },
    },
  });

  await fastify.register(swaggerUi, { routePrefix: '/docs' });

  fastify.post<{ Body: { file?: string; dryRun?: boolean; temperature?: number } }>(
    '/promptUpdate',
    {
      schema: {
        description: 'manifest.yaml 기준으로 prompts/*.md 파일을 Redis에 반영합니다.',
        body: {
          type: 'object',
          properties: {
            file: { type: 'string', description: '특정 파일만 반영 (예: weather_answer.md). 생략 시 전체.' },
            dryRun: { type: 'boolean', description: 'true면 Redis에 쓰지 않고 결과만 미리보기' },
            temperature: { type: 'number', description: 'temperature 오버라이드 (실험용, 생략 시 manifest/기존값 유지)' },
          },
        },
      },
    },
    async (req, reply) => {
      const { file, dryRun, temperature } = req.body ?? {};
      try {
        const results = await syncPrompts(file, dryRun ?? false, temperature);
        return {
          count: results.length,
          updated: results.filter((r) => r.action !== 'unchanged').length,
          dryRun: dryRun ?? false,
          results,
        };
      } catch (err) {
        reply.code(400);
        return { error: (err as Error).message };
      }
    }
  );

  fastify.get(
    '/status',
    {
      schema: {
        description: 'manifest 대상 키들의 현재 상태 (llm_id, 파일과 일치 여부)를 조회합니다.',
      },
    },
    async (_req, reply) => {
      try {
        return { status: await getStatus() };
      } catch (err) {
        reply.code(500);
        return { error: (err as Error).message };
      }
    }
  );

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`\n[prompt-update] server : http://localhost:${PORT}`);
  console.log(`[prompt-update] swagger : http://localhost:${PORT}/docs`);
  console.log(`[prompt-update] prompts : ${getPromptsDir()}\n`);

  if (process.env.WATCH === 'true') {
    startWatcher();
  }
}

function startWatcher() {
  const promptsDir = getPromptsDir();
  let timer: NodeJS.Timeout | undefined;
  const pending = new Set<string>();

  fs.watch(promptsDir, (_event, fileName) => {
    if (!fileName || (!fileName.endsWith('.md') && fileName !== 'manifest.yaml')) return;
    pending.add(fileName);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const changed = [...pending];
      pending.clear();
      try {
        if (changed.includes('manifest.yaml')) {
          await syncPrompts();
        } else {
          for (const file of changed) await syncPrompts(file);
        }
      } catch (err) {
        console.error(`[prompt-update] watch sync failed: ${(err as Error).message}`);
      }
    }, 300);
  });

  console.log(`[prompt-update] watching ${promptsDir} — 파일 저장 시 자동 반영\n`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
