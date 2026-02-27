# Backend (FastAPI)

## Run locally

1. Create virtual environment and install dependencies:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

2. Copy env file:

```bash
copy .env.example .env
```

3. Start API:

```bash
uvicorn app.main:app --reload --port 8000
```

4. Open docs:

- Swagger UI: `http://localhost:8000/docs`

## Notes

- `USE_IN_MEMORY_STORE=true` lets you run immediately with a seeded client (`READYONE01`).
- Set `USE_IN_MEMORY_STORE=false` and provide Supabase credentials to use real Supabase tables.
- `MONDAY_MOCK_MODE=true` returns mock item IDs for local development.
- Use `POST /api/v1/admin/monday/verify` (admin key required) to validate a Monday token/board pair before live submissions.
- OpenAI is the only supported LLM backend in this build:
  - Set `OPENAI_API_KEY`
  - Optional: set `OPENAI_MODEL` (default `gpt-4.1-nano`)
  - Optional: set `OPENAI_BASE_URL` only if you intentionally proxy OpenAI API calls
- `CHAT_REQUIRE_LLM=true` enforces LLM-first chat behavior. If no working OpenAI client is configured, chat responds with setup guidance.
- `POST /api/v1/intake/normalize-answer` normalizes free-form chatbot answers into structured values (choices, dates, lists, IDs).
- `POST /api/v1/chat/message` provides a session-based conversational intake agent (human-style chat flow).
- `CHAT_USE_LLM_RESPONSE_GENERATION=true` enables LLM-generated non-question assistant replies (welcome, retries, confirmations, errors) with safe fallback text.
- `CHAT_USE_LLM_QUESTION_GENERATION=true` lets the agent generate natural next-question wording with the LLM (fallbacks to template text if unavailable).
