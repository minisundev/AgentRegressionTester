import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT ? Number(process.env.PG_PORT) : 5432,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});

export async function query<T>(sql: string, params: any[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows;
}

export async function getCacheData(key?: string): Promise<Array<Record<string, string>>> {
  const sql = `
    SELECT utter_hash, utter_text, response_text, response_type_cd,
           main_intent_code, sub_intent_code, effective_from, effective_to, entity, agent_code
    FROM public.cache
    WHERE status_cd = 'ACTIVE'
      AND (effective_from IS NULL OR effective_from <= NOW())
      AND (effective_to IS NULL OR effective_to >= NOW())
      ${key ? 'AND utter_text = $1' : ''}
  `;
  return query(sql, key ? [key] : []);
}

export async function getLlmData(llmId?: string): Promise<Array<Record<string, any>>> {
  const sql = `
    SELECT llm_id, llm_group, model_version, endpoint_url, llm_deploy
    FROM agent_cms.llm_management
    WHERE status_cd = 'ACTIVE'
      ${llmId ? 'AND llm_id = $1' : ''}
    ORDER BY llm_id ASC
  `;
  return query(sql, llmId ? [llmId] : []);
}

export async function getPromptData(key?: string): Promise<Array<Record<string, string>>> {
  const sql = `
    SELECT main_intent_code, sub_intent_code, prompt_type_cd, prompt_text,
           version, temperature, status_cd, created_at, updated_at, llm_id
    FROM agent_cms.agent_prompt
    WHERE status_cd = 'ACTIVE'
      ${key ? "AND (main_intent_code || ':' || sub_intent_code) = $1" : ''}
    ORDER BY prompt_id ASC
  `;
  return query(sql, key ? [key] : []);
}
