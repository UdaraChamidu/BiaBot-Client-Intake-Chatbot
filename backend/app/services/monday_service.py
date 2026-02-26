"""Monday.com integration service."""

import json
from uuid import uuid4

import httpx

from app.core.config import get_settings
from app.models.schemas import MondayCredentialCheckResponse, MondaySubmissionResult


class MondayService:
    def __init__(self) -> None:
        self.settings = get_settings()
        try:
            self.column_map = json.loads(self.settings.monday_column_map_json)
        except json.JSONDecodeError:
            self.column_map = {
                "status": "status",
                "client": "text_client",
                "client_code": "text_code",
                "service_type": "text_service",
                "audience": "text_audience",
                "due_date": "date_due",
                "urgency": "text_urgency",
                "approver": "text_approver",
                "summary": "long_summary",
                "links": "long_links",
            }

    def _headers(self, token: str) -> dict[str, str]:
        return {
            "Authorization": token,
            "Content-Type": "application/json",
        }

    def verify_credentials(
        self,
        *,
        api_token: str | None = None,
        board_id: str | None = None,
        query: str | None = None,
        force_live: bool = False,
    ) -> MondayCredentialCheckResponse:
        token = (api_token or self.settings.monday_api_token or "").strip()
        selected_board_id = (board_id or self.settings.monday_board_id or "").strip() or None

        if not force_live and not api_token and self.settings.monday_mock_mode:
            return MondayCredentialCheckResponse(
                ok=False,
                mock_mode=True,
                api_url=self.settings.monday_api_url,
                board_id=selected_board_id,
                board_found=None,
                error="MONDAY_MOCK_MODE is enabled. Disable it or set force_live=true to test the real API.",
            )

        if not token:
            return MondayCredentialCheckResponse(
                ok=False,
                mock_mode=False,
                api_url=self.settings.monday_api_url,
                board_id=selected_board_id,
                board_found=None,
                error="Monday API token is missing.",
            )

        if query:
            graphql_query = query
            variables: dict[str, object] = {}
        elif selected_board_id:
            graphql_query = """
            query VerifyMonday($boardIds: [ID!]) {
              me {
                id
                name
              }
              boards(ids: $boardIds) {
                id
                name
              }
            }
            """
            variables = {"boardIds": [selected_board_id]}
        else:
            graphql_query = """
            query VerifyMonday {
              me {
                id
                name
              }
            }
            """
            variables = {}

        try:
            response = httpx.post(
                self.settings.monday_api_url,
                headers=self._headers(token),
                json={"query": graphql_query, "variables": variables},
                timeout=30.0,
            )
            response.raise_for_status()
            payload = response.json()

            if payload.get("errors"):
                first_error = payload["errors"][0].get("message", "Unknown Monday API error")
                return MondayCredentialCheckResponse(
                    ok=False,
                    mock_mode=False,
                    api_url=self.settings.monday_api_url,
                    board_id=selected_board_id,
                    board_found=False if selected_board_id else None,
                    error=first_error,
                )

            data = payload.get("data", {})
            me = data.get("me") or {}
            boards = data.get("boards") or []

            board_name = None
            board_found: bool | None = None
            if selected_board_id:
                board_found = False
                for board in boards:
                    if str(board.get("id")) == str(selected_board_id):
                        board_name = board.get("name")
                        board_found = True
                        break

            return MondayCredentialCheckResponse(
                ok=True,
                mock_mode=False,
                api_url=self.settings.monday_api_url,
                account_id=str(me.get("id")) if me.get("id") is not None else None,
                account_name=me.get("name"),
                board_id=selected_board_id,
                board_name=board_name,
                board_found=board_found,
            )
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code if exc.response else "unknown"
            detail = exc.response.text if exc.response else str(exc)
            return MondayCredentialCheckResponse(
                ok=False,
                mock_mode=False,
                api_url=self.settings.monday_api_url,
                board_id=selected_board_id,
                board_found=False if selected_board_id else None,
                error=f"HTTP {status_code}: {detail}",
            )
        except Exception as exc:
            return MondayCredentialCheckResponse(
                ok=False,
                mock_mode=False,
                api_url=self.settings.monday_api_url,
                board_id=selected_board_id,
                board_found=False if selected_board_id else None,
                error=str(exc),
            )

    def create_item(
        self,
        *,
        client_profile: dict,
        payload: dict,
        summary: str,
    ) -> MondaySubmissionResult:
        if self.settings.monday_mock_mode or not self.settings.monday_api_token or not self.settings.monday_board_id:
            return MondaySubmissionResult(
                item_id=f"mock-{uuid4().hex[:10]}",
                board_id=self.settings.monday_board_id,
                mock_mode=True,
            )

        column_values = {
            self.column_map["status"]: {"label": "New"},
            self.column_map["client"]: client_profile.get("client_name", ""),
            self.column_map["client_code"]: client_profile.get("client_code", ""),
            self.column_map["service_type"]: payload.get("service_type", ""),
            self.column_map["audience"]: payload.get("target_audience", ""),
            self.column_map["due_date"]: {"date": payload.get("due_date")},
            self.column_map["urgency"]: payload.get("time_sensitivity", ""),
            self.column_map["approver"]: payload.get("approver", ""),
            self.column_map["summary"]: summary,
            self.column_map["links"]: "\n".join(payload.get("references", [])),
        }

        mutation = """
        mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
          create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
            id
          }
        }
        """

        headers = self._headers(self.settings.monday_api_token)
        variables = {
            "boardId": self.settings.monday_board_id,
            "itemName": payload.get("project_title", "Untitled Project"),
            "columnValues": json.dumps(column_values),
        }

        response = httpx.post(
            self.settings.monday_api_url,
            headers=headers,
            json={"query": mutation, "variables": variables},
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()
        item_id = data.get("data", {}).get("create_item", {}).get("id")
        if not item_id:
            raise RuntimeError(f"Monday create_item failed: {data}")

        update_mutation = """
        mutation CreateUpdate($itemId: ID!, $body: String!) {
          create_update(item_id: $itemId, body: $body) {
            id
          }
        }
        """

        update_response = httpx.post(
            self.settings.monday_api_url,
            headers=headers,
            json={"query": update_mutation, "variables": {"itemId": item_id, "body": summary}},
            timeout=30.0,
        )
        update_response.raise_for_status()

        return MondaySubmissionResult(
            item_id=str(item_id),
            board_id=self.settings.monday_board_id,
            mock_mode=False,
        )
