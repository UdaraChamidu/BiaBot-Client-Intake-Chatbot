"""Monday.com integration service."""

import json
from uuid import uuid4

import httpx

from app.core.config import get_settings
from app.models.schemas import MondaySubmissionResult


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

        headers = {
            "Authorization": self.settings.monday_api_token,
            "Content-Type": "application/json",
        }
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
