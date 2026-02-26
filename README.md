# BiaBot Client Intake Chatbot (MVP)

Implementation aligned to `BiaBot_Subscription.docx`:

- FastAPI backend
- Supabase-ready persistence (with in-memory fallback for local)
- OpenAI summary polishing (optional)
- Monday integration (mock mode by default)
- React chatbot UI (one-question-at-a-time with branching)
- Basic admin panel

## Project structure

- `backend/` - FastAPI API + Supabase schema + docs
- `frontend/` - React/Vite app for client intake and admin

## Quick local startup

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

## Default local credentials

- Client code: `READYONE01`
- Admin key: `dev-admin-key` (from backend `.env`)

## Next configuration step after local run

1. Apply `backend/sql/supabase_schema.sql` in Supabase.
2. Switch `USE_IN_MEMORY_STORE=false`.
3. Replace Monday mock config with real board and columns.
4. Configure AI provider:
   - Claude: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...`, optional `AI_MODEL`
   - OpenAI: `AI_PROVIDER=openai`, `OPENAI_API_KEY=...`, optional `AI_MODEL`
   - Free OpenAI-compatible model: `AI_PROVIDER=openai_compatible`, `AI_BASE_URL=...`, `AI_API_KEY=...`, `AI_MODEL=...`
