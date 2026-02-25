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
- Set `OPENAI_API_KEY` to enable AI-polished summaries.
