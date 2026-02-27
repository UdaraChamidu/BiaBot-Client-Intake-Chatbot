# BiaBot Client Intake Chatbot (MVP)

Implementation aligned to `BiaBot_Subscription.docx`:

- FastAPI backend
- Supabase-ready persistence (with in-memory fallback for local)
- OpenAI summary polishing (optional)
- Monday integration (mock mode by default)
- React conversational chatbot UI (chat-based auth + one-question flow with branching)
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
2. Apply `backend/sql/dev_seed_client_profile.sql` for a test client code (`READYONE01`).
3. Switch `USE_IN_MEMORY_STORE=false`.
4. Replace Monday mock config with real board and columns.
5. Configure OpenAI:
   - `OPENAI_API_KEY=...`
   - optional `OPENAI_MODEL` (default: `gpt-4.1-nano`)
   - optional `OPENAI_BASE_URL` only if you proxy OpenAI API calls
