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
