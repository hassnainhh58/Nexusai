import os
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Adjust import path for the FastAPI app
import sys
sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.main import app

client = TestClient(app)

@pytest.fixture(scope="module")
def auth_header():
    # No token – should trigger fallback anonymous user
    return {"Authorization": "Bearer "}

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "ok"

def test_models_endpoint():
    response = client.get("/v1/models")
    # The endpoint should exist after our fix and return a list of models
    assert response.status_code == 200
    data = response.json()
    # Expect the response to contain a "data" key with a list of model objects
    assert isinstance(data, dict)
    assert "data" in data
    assert isinstance(data["data"], list)
    # At least one model should be present (the provider supplies it)
    assert len(data["data"]) > 0
    # Verify required fields in a model entry
    model = data["data"][0]
    assert "id" in model
    assert "object" in model
    assert model["object"] == "model"

def test_chat_endpoint_requires_user(auth_header):
    # Send a minimal chat payload; the endpoint should succeed even with fallback user
    payload = {
        "messages": [{"role": "user", "content": "Hello"}],
        "model": os.getenv("LLM_MODEL", "gpt-3.5-turbo")
    }
    response = client.post("/api/chat", json=payload, headers=auth_header)
    # The endpoint streams; TestClient aggregates the response body
    assert response.status_code == 200
    # The response should be a streaming JSON lines; we check that we received something
    assert response.content
    # The first line should be a JSON object with a "choices" key
    first_line = response.content.splitlines()[0]
    try:
        obj = json.loads(first_line)
        assert "choices" in obj
    except json.JSONDecodeError:
        pytest.fail("First line of streaming response is not valid JSON")
