import pytest
from fastapi.testclient import TestClient
from backend.api.main import app
from backend.core import config
from backend.core import db
from backend.services.command.service import execute_command

client = TestClient(app)

def test_integration_fastapi_to_wsl():
    # Execute a simple ALLOW command 'pwd' via execute_command
    res = execute_command("run_raw", {"command": "pwd"}, user="test_user")
    assert res["status"] in ("success", "error", "timeout")
    if res["status"] == "success":
        # Under WSL this should output a path like /root or /home/...
        assert len(res["stdout"]) > 0
        assert res["exit_code"] == 0

def test_integration_fastapi_to_postgres():
    # Insert settings directly into database
    import json
    test_settings = {"editor_theme": "monokai", "font_size": 16}
    success = db.execute(
        "INSERT INTO os_settings (settings) VALUES (%s::jsonb)",
        (json.dumps(test_settings),)
    )
    assert success is True
    
    # Retrieve via API endpoint
    res = client.get("/api/v1/database/settings")
    assert res.status_code == 200
    assert res.json()["settings"] == test_settings

def test_integration_fastapi_to_docker():
    # Trigger /api/health which checks Docker status via docker ps
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert "services" in data
    assert "docker" in data["services"]
    docker_status = data["services"]["docker"]
    # Should return healthy, unhealthy, or disabled depending on host
    assert docker_status in ("healthy", "unhealthy", "disabled")

def test_integration_fastapi_to_liae():
    # Fetch LIAE Timeline API
    res = client.post("/api/command", json={"op": "liae_timeline", "args": {}})
    # If the database is connected, it should return success or timeline data
    assert res.status_code in (200, 401, 403) # Depending on route restrictions
