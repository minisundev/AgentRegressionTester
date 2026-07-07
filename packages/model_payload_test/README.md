# model-tester

Redis Stream consumer for comparing one answer payload across three models:

- tuned Gemma endpoint from `config:llm:${GEMMA_TEST_LLM_ID}`
- local Ollama OpenAI-compatible endpoint
- GPT/Azure OpenAI endpoint from `config:llm:${GPT_TEST_LLM_ID}`

## Setup

```bash
npm install
```

Run `npm install` from the repository root. Fill Redis, model, and optional
Google Sheets environment values in the root `.env`.

## Run

Start the source service with stream publishing enabled:

```bash
WEATHER_ANSWER_COMPARE_STREAM_KEY=weather:answer-compare npm run local
```

Run this watcher with terminal output:

```bash
npm run watch:weather:answer-compare
```

Append rows to Google Sheets:

```bash
REPORT_TO=sheet npm run watch:weather:answer-compare
```

Read already-existing stream entries when creating the consumer group:

```bash
READ_EXISTING_PAYLOADS=1 npm run watch:weather:answer-compare
```

The producer payload is expected in Redis Stream field `payload` as JSON.
When sheet reporting is enabled, the `payload` JSON and its `prompt`
are appended in the `Dumped Payload` and `Prompt` columns.
Credential-like payload fields (for example `auth_key`) are redacted first.

Set `EVALUATE_PAYLOAD_WITH_GPT=1` to append an independent payload-policy
evaluation (intent, entity/time extraction, card/data scope, fallback, clamping,
and multi-turn inheritance) to the same row.

For combined API-response + LLM-payload audits, enable
`PUBLISH_AGENT_RESPONSE_STREAM=1` in the test runner and
`JOIN_AGENT_RESPONSE_STREAM=1` in this watcher. Records are joined by
`transactionId`/`trxId`; entity and all card types are written beside the
payload-policy evaluation.
