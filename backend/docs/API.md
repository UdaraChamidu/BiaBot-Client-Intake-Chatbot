# API Reference (MVP)

Base URL (local): `http://localhost:8000/api/v1`

## Health

- `GET /health`

## Client/Auth

- `POST /auth/client-code`
  - Body:
    ```json
    {
      "client_code": "READYONE01"
    }
    ```
  - Returns client JWT token + profile.

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

- `POST /intake/submit`
  - Header: `Authorization: Bearer <token>`
  - Body: `IntakeSubmission` payload
  - Persists request log and sends to Monday (mock mode by default).

## Admin

All admin routes require header `x-admin-key`.

- `GET /admin/client-profiles`
- `POST /admin/client-profiles`
- `PUT /admin/client-profiles/{client_code}`
- `GET /admin/service-options`
- `PUT /admin/service-options`
- `GET /admin/request-logs?limit=50`

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
