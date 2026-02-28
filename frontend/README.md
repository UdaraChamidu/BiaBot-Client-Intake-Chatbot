# Frontend (React + Vite)

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Configure env:

```bash
copy .env.example .env
```

3. Start dev server:

```bash
npm run dev
```

## Features implemented

- Fully conversational chatbot UI (bot greets first and asks for client code)
- Free-text auth step (supports messages like "my client code is READYONE01")
- One-question-at-a-time guided chat flow with branching by service type
- Chat-based mission summary preview and submit confirmation
- Submit request to backend/Monday mock
- Basic admin page for:
  - password-gated admin access
  - add/edit client profiles
  - credit menu editing per client
  - global service option management
  - request log viewing
