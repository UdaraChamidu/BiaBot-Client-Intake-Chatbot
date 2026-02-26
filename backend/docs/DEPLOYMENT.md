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

## AI Provider Setup

1. Claude (Anthropic):
   - `AI_PROVIDER=anthropic`
   - `ANTHROPIC_API_KEY`
   - optional `AI_MODEL` (or use `ANTHROPIC_MODEL`)

2. OpenAI:
   - `AI_PROVIDER=openai`
   - `OPENAI_API_KEY` (or `AI_API_KEY`)
   - optional `AI_MODEL` (or use `OPENAI_MODEL`)

3. OpenAI-compatible providers (many free models):
   - `AI_PROVIDER=openai_compatible`
   - `AI_BASE_URL`
   - `AI_API_KEY`
   - `AI_MODEL`

4. Disable AI and use deterministic summaries:
   - `AI_PROVIDER=none`

## Production Targets (later phase)

- Backend: containerized FastAPI on Render/Railway/Fly or similar.
- Frontend: Vite static build on Vercel/Netlify.
- Secrets: environment variables in hosting platform.
- Add HTTPS, strict CORS allowlist, and log monitoring.
