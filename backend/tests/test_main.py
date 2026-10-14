"""Tests for the Meeting Notes AI backend.

These tests run entirely offline: external services (Deepgram, OpenAI) are
disabled via the ``_isolate`` fixture, so no network access or API keys are
required.
"""

import asyncio

import jwt
import pytest
from fastapi.testclient import TestClient

import main


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """Disable external integrations for every test."""
    monkeypatch.setattr(main, "DEEPGRAM_API_KEY", "")
    monkeypatch.setattr(main, "llm_client", None)


@pytest.fixture()
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_correlation_id_header_present(client):
    response = client.get("/health")
    assert response.headers.get("X-Correlation-ID")


def test_token_is_valid_jwt(client):
    response = client.post("/v1/token", json={"meeting_id": "m-123"})
    assert response.status_code == 200
    token = response.json()["token"]

    payload = jwt.decode(token, main.JWT_SECRET, algorithms=["HS256"])
    assert payload["meeting_id"] == "m-123"
    assert "exp" in payload
    assert "iat" in payload


def test_token_requires_meeting_id(client):
    assert client.post("/v1/token", json={}).status_code == 422


def test_websocket_start_then_stop_returns_notes(client):
    with client.websocket_connect("/ws/meeting-a") as ws:
        ws.send_json({"type": "start_meeting", "meeting_title": "Standup"})
        status = ws.receive_json()
        assert status == {"type": "status_update", "status": "recording"}

        ws.send_json({"type": "stop_meeting"})
        notes = ws.receive_json()
        assert notes["type"] == "notes"
        assert notes["meeting_id"] == "meeting-a"
        assert notes["decisions"] == []
        assert notes["action_items"] == []


def test_websocket_generate_summary_without_llm(client):
    with client.websocket_connect("/ws/meeting-b") as ws:
        ws.send_json({"type": "generate_summary"})
        message = ws.receive_json()
        assert message["type"] == "summary"
        assert message["kind"] == "rolling"
        assert message["summary"] == "LLM not configured"


def test_websocket_ignores_malformed_control_message(client):
    with client.websocket_connect("/ws/meeting-c") as ws:
        ws.send_text("this is not json")
        ws.send_json({"type": "generate_summary"})
        assert ws.receive_json()["type"] == "summary"


def test_session_transcript_text_limit():
    session = {"transcript": [{"text": "a"}, {"text": "b"}, {"text": "c"}]}
    assert main._session_transcript_text(session, 2) == "b c"
    assert main._session_transcript_text(session) == "a b c"


def test_summary_token_budget_enforced(monkeypatch):
    monkeypatch.setattr(main, "llm_client", object())
    monkeypatch.setattr(main, "TOKEN_BUDGET", 1)
    main.session_token_usage["budget-meeting"] = 1000

    result = asyncio.run(main.generate_summary("some transcript text", "budget-meeting"))
    assert "budget" in result["summary"].lower()
