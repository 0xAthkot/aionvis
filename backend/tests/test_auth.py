"""AA_API_KEY guard: REST middleware + WebSocket ?token= handshake.

Run:  .venv\\Scripts\\python -m pytest tests/test_auth.py -q
"""

import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)  # no lifespan: store stays empty, which is fine here


@pytest.fixture()
def keyed(monkeypatch):
    monkeypatch.setattr(settings, "aa_api_key", "test-key-123")


def test_open_mode_without_key():
    assert not settings.aa_api_key  # dev default
    assert client.get("/api/v1/projects").status_code == 200


def test_rest_requires_key(keyed):
    r = client.get("/api/v1/projects")
    assert r.status_code == 401
    body = r.json()
    assert body["code"] == "unauthorized" and body["status"] == 401


def test_rest_accepts_bearer_and_header(keyed):
    ok = client.get("/api/v1/projects",
                    headers={"Authorization": "Bearer test-key-123"})
    assert ok.status_code == 200
    ok2 = client.get("/api/v1/projects", headers={"X-API-Key": "test-key-123"})
    assert ok2.status_code == 200
    bad = client.get("/api/v1/projects",
                     headers={"Authorization": "Bearer wrong"})
    assert bad.status_code == 401


def test_health_and_files_stay_public(keyed):
    assert client.get("/health").status_code == 200
    # /files is a static mount; 404 for a missing file, never 401.
    assert client.get("/files/nope.jpg").status_code == 404


def test_ws_rejects_bad_token(keyed):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/v1/runs/run_x/events?token=wrong"):
            pass
    assert exc.value.code == 1008


def test_ws_accepts_token(keyed):
    with client.websocket_connect("/ws/v1/runs/run_x/events?token=test-key-123"):
        pass  # handshake accepted is the assertion


def test_ws_open_without_key():
    with client.websocket_connect("/ws/v1/runs/run_x/events"):
        pass
