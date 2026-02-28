# API Reference (MVP)

Base URL (local): `http://localhost:8000/api/v1`

## Health

- `GET /health`

## Chat Agent

- `POST /chat/message`
  - Session-based conversational endpoint for AI intake flow.
  - Body:
    ```json
    {
      "session_id": null,
      "message": "my client code is READYONE01",
      "reset": false
    }
    ```
  - Returns assistant reply, current phase, suggestions, and profile/session context.

## Client/Auth

- `POST /auth/client-code`
  - Body:
    ```json
    {
      "client_code": "READYONE01"
    }
    ```
  - Returns client JWT token + profile.
  - Also accepts free-form input in `client_code`, for example:
    - `"my client id is READYONE01"`
    - `"client code: READYONE01"`

- `GET /client/profile`
  - Header: `Authorization: Bearer <token>`

## Intake

- `GET /intake/options`
  - Header: `Authorization: Bearer <token>`
  - Returns service options, core questions, and branch questions.

- `POST /intake/preview`
  - Header: `Authorization: Bearer <token>`
  - Body: `IntakeSubmission` payload
  - Returns contractor-ready summary text.

- `POST /intake/normalize-answer`
  - Header: `Authorization: Bearer <token>`
  - Body:
    ```json
    {
      "question_id": "due_date",
      "question_type": "date",
      "answer_text": "due next friday",
      "required": true,
      "options": [],
      "question_label": "Due Date"
    }
    ```
  - Returns normalized value + validation status for free-form chat answers.
  - Used internally by the chat agent flow.

- `POST /intake/submit`
  - Header: `Authorization: Bearer <token>`
  - Body: `IntakeSubmission` payload
  - Persists request log and sends to Monday (mock mode by default).

## Admin

Admin password verification endpoint:
- `POST /admin/auth`
  - Body:
    ```json
    {
      "password": "dev-admin-key"
    }
    ```

All protected admin routes require header `x-admin-password` (or legacy `x-admin-key`).

- `GET /admin/client-profiles`
- `POST /admin/client-profiles`
- `PUT /admin/client-profiles/{client_code}`
- `GET /admin/service-options`
- `PUT /admin/service-options`
- `GET /admin/request-logs?limit=50`
- `POST /admin/monday/verify`
  - Body:
    ```json
    {
      "api_token": "your-monday-token",
      "board_id": "1234567890",
      "query": null,
      "force_live": true
    }
    ```
  - Verifies Monday token/board access and returns account + board lookup results.

## IntakeSubmission Schema

```json
{
  "service_type": "Campaign set (up to 6 assets)",
  "project_title": "March Hiring Push",
  "goal": "Increase job applications",
  "target_audience": "Job seekers",
  "primary_cta": "Apply Now",
  "time_sensitivity": "Urgent",
  "due_date": "2026-03-05",
  "approver": "Lupita R.",
  "required_elements": "QR code, EOE disclaimer",
  "references": ["https://example.com/ref"],
  "uploaded_files": ["brief.pdf"],
  "branch_answers": {
    "channels": "LinkedIn, Email, Careers page",
    "asset_list": "Hero image, social posts, email banner",
    "launch_timeline": "Week 1 launch",
    "paid_promo": "Yes"
  },
  "notes": "Optional note"
}
```
