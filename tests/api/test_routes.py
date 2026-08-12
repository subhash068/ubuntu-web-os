import pytest
from fastapi.testclient import TestClient
from backend.api.main import app
from backend.core import config
from backend.core import db

client = TestClient(app)

def test_health_endpoints():
    # Live probe
    res = client.get("/api/health/live")
    assert res.status_code == 200
    assert res.json() == {"status": "alive"}
    
    # Detailed health
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert "status" in data
    assert "services" in data
    assert "database" in data["services"]
    assert "linux" in data["services"]

    # Ready probe
    res = client.get("/api/health/ready")
    assert res.status_code in (200, 503)

def test_database_notes_and_settings():
    # Test GET notes
    res = client.get("/api/db/notes")
    assert res.status_code == 200
    assert "content" in res.json()
    
    # Test POST notes
    res = client.post("/api/db/notes", json={"content": "test notes contents"})
    assert res.status_code == 200
    assert res.json() == {"success": True}
    
    # Verify note was written
    res = client.get("/api/db/notes")
    assert res.json()["content"] == "test notes contents"

    # Test GET settings
    res = client.get("/api/db/settings")
    assert res.status_code == 200
    assert "settings" in res.json()
    
    # Test POST settings
    res = client.post("/api/db/settings", json={"settings": {"theme": "dark"}})
    assert res.status_code == 200
    assert res.json() == {"success": True}
    
    # Verify settings were written
    res = client.get("/api/db/settings")
    assert res.json()["settings"] == {"theme": "dark"}

def test_auth_login_logout_flow():
    # Login with invalid credentials
    res = client.post("/api/login", json={"username": "kali", "password": "wrongpassword"})
    assert res.status_code == 401
    
    # Login with valid credentials
    res = client.post("/api/login", json={"username": config.OS_WEBOS_USER, "password": config.OS_WEBOS_PASS})
    assert res.status_code == 200
    data = res.json()
    assert "csrf" in data
    csrf_token = data["csrf"]
    
    # Check that session cookies are set
    assert "session" in client.cookies
    assert "session_sig" in client.cookies
    
    # Get profile (requires auth & CSRF)
    headers = {"X-CSRF-Token": csrf_token}
    res = client.get("/api/get_profile", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"username": config.OS_WEBOS_USER}
    
    # Get profile with missing CSRF
    res = client.get("/api/get_profile")
    assert res.status_code == 403
    
    # Logout
    res = client.post("/api/logout")
    assert res.status_code == 200
    
    # Verify cookies cleared and auth rejected
    assert "session" not in client.cookies or client.cookies["session"] == ""
    res = client.get("/api/get_profile", headers=headers)
    assert res.status_code == 401

def test_rate_limiting():
    # Check that repeatedly hitting routes triggers rate limits eventually
    # We hit /api/health/live repeatedly.
    # Note: rate limit check is per client IP. TestClient uses 'testclient' or 127.0.0.1.
    # To keep this test deterministic without blocking subsequent tests, we reset the store.
    from backend.core.security import RATE
    RATE.clear()
    
    # Hit login/command up to threshold
    limit = config.OS_WEBOS_RATE_LIMIT_MAX
    
    # Mock hitting endpoint
    from backend.core.security import rate_limit_check
    ip = "127.0.0.1"
    
    for _ in range(limit):
        rate_limit_check(ip)
        
    # Threshold reached: next call should be rate limited
    assert rate_limit_check(ip) is True
    
    # Reset for other tests
    RATE.clear()

def test_request_size_limit_check():
    # Construct a payload larger than max request size
    large_payload = "a" * (config.OS_WEBOS_MAX_REQUEST_BYTES + 10)
    res = client.post("/api/login", content=large_payload, headers={"Content-Type": "application/json"})
    assert res.status_code == 413
    assert res.json() == {"error": "Request too large"}

def test_output_limit_truncation():
    from backend.services.command.service import truncate_output
    text = "hello world"
    
    # Truncate smaller than string size
    truncated, is_trunc = truncate_output(text, 5)
    assert is_trunc is True
    assert len(truncated.encode("utf-8")) == 5
    assert truncated == "hello"

    # Truncate larger than string size
    truncated, is_trunc = truncate_output(text, 100)
    assert is_trunc is False
    assert truncated == text

