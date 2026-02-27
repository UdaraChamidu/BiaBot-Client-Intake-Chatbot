# Deployment Notes (Initial)

## Local (Current)

1. Configure `.env` from `.env.example`.
2. Run `uvicorn app.main:app --reload --port 8000`.
3. Keep `MONDAY_MOCK_MODE=true` for safe local testing.
4. Use `USE_IN_MEMORY_STORE=true` unless Supabase credentials are ready.

## Supabase Setup

1. In Supabase SQL editor, run `sql/supabase_schema.sql`.
2. For local testing, run `sql/dev_seed_client_profile.sql`.
3. Set:
   - `USE_IN_MEMORY_STORE=false`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`

## Monday Setup

1. Set:
   - `MONDAY_MOCK_MODE=false`
   - `MONDAY_API_TOKEN`
   - `MONDAY_BOARD_ID`
   - `MONDAY_COLUMN_MAP_JSON` with real column IDs

## AI Setup (OpenAI Only)

1. Set:
   - `OPENAI_API_KEY`
   - optional `OPENAI_MODEL` (default `gpt-4.1-nano`)
   - optional `OPENAI_BASE_URL` if you proxy OpenAI calls

2. Keep:
   - `CHAT_REQUIRE_LLM=true`
   - `CHAT_USE_LLM_RESPONSE_GENERATION=true`
   - `CHAT_USE_LLM_QUESTION_GENERATION=true`

## Production Targets (later phase)

- Backend: containerized FastAPI on Render/Railway/Fly or similar.
- Frontend: Vite static build on Vercel/Netlify.
- Secrets: environment variables in hosting platform.
- Add HTTPS, strict CORS allowlist, and log monitoring.
