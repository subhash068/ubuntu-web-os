import hmac
import secrets
import time
from backend.core.config import (
    OS_WEBOS_SESSION_SECRET, SESSION_TTL_SEC,
    OS_WEBOS_RATE_LIMIT_MAX, OS_WEBOS_RATE_LIMIT_WINDOW_SEC
)
from backend.core import db
from backend.core import logger

# In-memory stores
RATE = {}  # ip -> [(timestamp, ...)]

def sign_session_id(session_id: str) -> str:
    return hmac.new(
        OS_WEBOS_SESSION_SECRET.encode("utf-8"),
        session_id.encode("utf-8"),
        digestmod="sha256"
    ).hexdigest()

def create_session(username: str) -> tuple[str, str]:
    session_id = secrets.token_urlsafe(24)
    csrf = secrets.token_urlsafe(24)
    exp = int(time.time()) + SESSION_TTL_SEC
    
    query = """
        INSERT INTO os_sessions (session_id, username, csrf, exp)
        VALUES (%s, %s, %s, %s)
    """
    success = db.execute(query, (session_id, username, csrf, exp))
    if not success:
        logger.error("security", "create_session", "failed to insert session in db")
    return session_id, csrf

def validate_session(session_id: str, sig: str) -> dict:
    if not session_id or not sig:
        return None
        
    # Verify HMAC signature
    expected_sig = sign_session_id(session_id)
    if not hmac.compare_digest(expected_sig, sig):
        logger.warn("security.session_validation", reason="signature_mismatch")
        return None
        
    # Get session from DB
    res = db.fetch_one(
        "SELECT username, csrf, exp FROM os_sessions WHERE session_id = %s",
        (session_id,)
    )
    if not res:
        return None
        
    username, csrf, exp = res
    now = time.time()
    
    if now > exp:
        # Expired - delete from DB
        db.execute("DELETE FROM os_sessions WHERE session_id = %s", (session_id,))
        logger.info("security.session_expired", user=username)
        return None
        
    return {"user": username, "csrf": csrf, "exp": exp}

def delete_session(session_id: str):
    db.execute("DELETE FROM os_sessions WHERE session_id = %s", (session_id,))

def validate_csrf(token: str, session_csrf: str) -> bool:
    if not token or not session_csrf:
        return False
    return token == session_csrf

def rate_limit_check(client_ip: str) -> bool:
    now = time.time()
    window_start = now - OS_WEBOS_RATE_LIMIT_WINDOW_SEC

    times = RATE.get(client_ip, [])
    times = [t for t in times if t >= window_start]
    
    if len(times) >= OS_WEBOS_RATE_LIMIT_MAX:
        RATE[client_ip] = times
        logger.warn("security.rate_limit_exceeded", ip=client_ip, count=len(times))
        return True

    times.append(now)
    RATE[client_ip] = times
    return False
