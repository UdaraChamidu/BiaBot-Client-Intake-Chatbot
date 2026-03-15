# BiaBot Client Intake Chatbot

BiaBot is a client-facing intake workspace for Bianomics. It verifies a client code, guides the client through a structured request conversation, builds a review-ready mission summary, allows PDF export, and submits approved requests into Monday while giving admins a separate console for profile management, audit history, and operational visibility.

This repository is currently an MVP, but it already covers the full request lifecycle from client entry to internal handoff.

## What This Project Is For

Bianomics needs a cleaner way to collect repeat client requests than scattered email threads, chat messages, or incomplete forms. This project turns intake into a guided experience with three goals:
- FastAPI backend
- Supabase-ready persistence (with in-memory fallback for local) 
- OpenAI summary polishing (optional)
- Monday integration (mock mode by default)
- React conversational chatbot UI (chat-based auth + one-question flow with branching)
- Basic admin panel

- make it easy for clients to submit the right details in one place
- preserve client-specific context such as tone, disclaimers, approvers, and service availability
- give admins a reliable audit trail of what was submitted, when it was submitted, and where it was sent next

## Who Uses It

### Clients

Clients use the main intake workspace at the root route. They authenticate with a client code, answer guided questions in natural language, review the generated summary, and submit the request to Bianomics.

### Admins

Admins use the admin console to manage client profiles, review submitted work, inspect request and login history, monitor notifications, and export request summaries as PDFs.

### Internal Delivery Team

Once a request is approved, the system can create a Monday item and preserve an internal request record so the internal team has both a task destination and an audit snapshot.

## Core Product Flow

### 1. Client enters the workspace

The intake flow starts as a conversation. The assistant greets the user and asks for a client code before exposing client-specific workspace details.

What happens at this step:

- the system accepts free-form client code messages, not just exact form-style input
- successful verification loads the client profile
- the login is recorded for audit purposes
- the workspace becomes personalized with that client's available service options and profile metadata

### 2. Client selects a service

After authentication, the client chooses the type of support they need. Service options can come from:

- a client-specific service list stored on the profile
- a global fallback service list maintained by admins

The seeded default catalog includes:

- Campaign set (up to 6 assets)
- Custom graphic
- Moderate layout graphic
- Internal newsletter (up to 3 pages)
- External newsletter (up to 3 pages)
- Press release
- Press release package
- Other

### 3. BiaBot asks structured intake questions

The assistant walks the client through one question at a time. The question queue combines:

- core questions that every request should answer
- service-specific branch questions
- an optional final prompt for file names or reference links

Core intake fields include:

- project title
- goal
- target audience
- primary call to action
- time sensitivity
- due date
- approver
- required elements
- references or links
- file names or attachment links

Branch questions depend on the service selected. Examples:

- graphic requests ask about dimensions, copy readiness, bilingual needs, image sourcing, and accessibility
- newsletter requests ask about tone, sections, content status, metrics, and distribution
- press release requests ask about announcement summary, quotes, boilerplate, media targets, and assets
- campaign requests ask about channels, asset list, launch timeline, and paid promotion
- "Other" requests fall back to open description and clarification fields

### 4. Answers are normalized into structured data

The chat experience is conversational, but the system still stores structured answers. It can:

- map free-form replies onto defined service options
- accept natural date language such as "tomorrow" or "next Friday"
- handle optional skips like `skip`, `none`, `n/a`, or `not applicable`
- keep list-style answers such as links or file references as clean arrays

The project is designed so the conversation feels natural while the stored result remains predictable.

### 5. The client reviews a mission summary

Once all required answers are collected, BiaBot generates a mission summary for review.

Important behavior:

- the summary is intentionally deterministic
- each asked field is preserved as its own summary key
- the client can revise the summary before submission
- if the summary is in key/value format, the review UI locks field names and only lets the client edit the values

At this stage the client can:

- update the summary
- download the summary as a PDF
- submit the request to Bianomics
- restart the intake and begin a new request

### 6. The request is submitted

On confirmation, the system:

- builds the final structured payload
- creates a Monday item or returns a mock item in demo mode
- stores a request log in the configured data store
- creates an admin notification
- updates the client's default approver if a new approver was provided

The user then receives a completion state that includes:

- request ID
- Monday item ID
- whether the submission used mock mode

## Client Workspace Details

The client-facing experience is more than a simple chat box. It includes:

- a personalized profile panel showing client code, subscription tier, preferred tone, brand voice rules, disclaimers, turnaround rules, compliance notes, common audiences, and credit menu
- session-based conversation history within the browser session
- suggestion chips for service options and structured answers
- optional voice input for spoken responses
- optional spoken assistant replies in supported browsers
- summary review and PDF download before submission

The profile panel is read-only for clients. Profile maintenance happens in the admin workspace.

## Admin Console Details

The admin area is a management console rather than a simple password gate. It includes multiple work areas:

### Dashboard

The dashboard gives a live operational snapshot, including:

- total clients
- recent requests
- requests in the last 7 days
- active clients in the last 30 days
- Monday coverage
- profile completeness
- top services
- client tier distribution
- recent submission activity

### Client Profiles

Admins can create, edit, and delete client profiles. A profile can store:

- client name and client code
- brand voice rules
- words to avoid
- required disclaimers
- preferred tone
- common audiences
- default approver
- subscription tier
- turnaround rules
- compliance notes
- client-specific service overrides
- credit menu values by service key

These profile fields shape the workspace the client sees and help Bianomics maintain consistent intake context across repeat requests.

### Credit Menu

Each client can have a service-key-to-credit mapping. In the current product, this is treated as an operational planning field that supports usage accounting and approval flow.

### Client Directory

Admins can browse and search client records, inspect full profile details, and review that client's submitted intake history in one place.

### Services

Admins can maintain the global service list. These are the default options shown when a client profile does not define its own service list.

### Audit Logs

The audit area exposes two major histories:

- request logs for submitted intake requests
- client login history for both chat-based and direct API authentication

Request logs store enough information to reconstruct what the client submitted, including:

- client identity
- service type
- project title
- mission summary
- structured payload
- Monday item ID
- submission timestamp

### Notifications

Admins receive notifications when new intake requests are submitted. Notifications can be:

- listed
- marked as read
- marked all read
- deleted

### PDF Export

Admins can download a PDF for a submitted client request directly from request history or client submission detail views.

What the admin PDF contains:

- client name and code
- service type
- project title
- submission date
- Monday item ID
- mission summary
- submitted field/value details

Note: the current export is for intake request data, not a separate client-profile PDF.

### Monday Verification

Admins can verify Monday credentials and board access before turning on live submissions. This makes it easier to confirm account and board configuration before sending real client work into production.

## Records and Outputs the System Produces

The project currently produces four important operational records:

### 1. Client profiles

Long-lived configuration records that shape each client's workspace and expectations.

### 2. Request logs

Immutable-style submission records used for audit, admin review, and PDF export.

### 3. Client login events

Authentication history showing when a client accessed the system and whether the login came from chat or a direct API route.

### 4. Admin notifications

Operational alerts tied to incoming submissions.

## Summary and PDF Behavior

The summary system is intentionally conservative:

- it does not collapse multiple questions into vague prose
- it preserves a one-field-per-line structure whenever possible
- it supports local editing before final submission
- it is the same content foundation used for PDF exports

There are two main PDF paths in the project:

- client-side PDF download during final review before submission
- admin-side PDF download for stored request logs after submission

## Operating Modes

The project can run in two practical modes:

### Demo / local mode

- uses a seeded client profile
- can run without live external persistence
- can return mock Monday item IDs
- is suitable for UI walkthroughs and flow testing

### Connected mode

- stores records in the configured persistent database
- creates real request logs, login events, and notifications
- can submit live items to Monday

## Built-in Demo Data

The repository includes a seeded example client so the experience works quickly in local development.

Default demo access:

- client code: `READYONE01`
- admin password: `dev-admin-key`

The seeded client represents "ReadyOne Industries" and includes example tone guidance, disclaimers, service options, audiences, and credit menu values.

## Project Structure

This repository is split by product surface rather than by deployment concern:

- `frontend/` - client intake workspace and admin console
- `backend/` - API routes, chat agent, summary generation, persistence adapters, PDF generation, and Monday handoff
- `backend/sql/` - database schema and seed scripts
- `backend/docs/` - API and deployment notes
- `data/` - original project reference documents and notes

## Quick Start

This README focuses on product behavior. If you just want to run the project locally, the shortest path is:

### 1. Start the backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

### 2. Start the frontend

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

## Important Current Scope Notes

To keep expectations clear, the current project behaves like this:

- active chat sessions are held in application memory, so in-progress conversations are not a durable server-side record
- the browser keeps a session snapshot for convenience, but a backend restart can still interrupt live chat continuity
- the "files" question captures file names or links only; it is not a full binary upload pipeline
- the main summary generator is deterministic by design, even when conversational AI features are enabled elsewhere in the flow
- the client-facing experience is the primary intake surface, while direct authenticated intake endpoints also exist for structured integrations and backend use cases

## Reference Documents

If you need implementation-level detail after reading this overview, use:

- `backend/README.md` for backend setup notes
- `frontend/README.md` for frontend setup notes
- `backend/docs/API.md` for route-level behavior
- `backend/docs/DEPLOYMENT.md` for deployment guidance
- `backend/sql/supabase_schema.sql` for the current persistent data model
- `data/BiaBot_Subscription.docx` for the original project reference material
