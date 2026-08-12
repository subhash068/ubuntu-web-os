import os
from fastapi import APIRouter, Request, Response, HTTPException, Cookie, Depends
from pydantic import BaseModel
from backend.core import config
from backend.core import security
from backend.core import logger

router = APIRouter()

class LoginRequest(BaseModel):
    username: str
    password: str

class ProfileUpdateRequest(BaseModel):
    username: str
    password: str

def get_current_session(
    request: Request,
    session: str = Cookie(None),
    session_sig: str = Cookie(None)
):
    if not session or not session_sig:
        raise HTTPException(status_code=401, detail="Not authenticated")
        
    sess = security.validate_session(session, session_sig)
    if not sess:
        raise HTTPException(status_code=401, detail="Not authenticated")
        
    # CSRF Token validation
    csrf_token = request.headers.get("X-CSRF-Token", "")
    if not csrf_token or not security.validate_csrf(csrf_token, sess["csrf"]):
        raise HTTPException(status_code=403, detail="Invalid CSRF token")
        
    return sess

@router.post("/login")
@router.post("/v1/auth/login")
async def login(payload: LoginRequest, request: Request, response: Response):
    # Rate limit check
    client_ip = request.client.host if request.client else "unknown"
    if security.rate_limit_check(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
        
    username = payload.username
    password = payload.password
    
    is_valid_default = (username == "kali" and password == "kali") or (username == "admin" and password == "admin")
    is_valid_env = (username == config.OS_WEBOS_USER and password == config.OS_WEBOS_PASS)
    
    if not (is_valid_env or is_valid_default):
        logger.warn("auth.login_failed", user=username)
        raise HTTPException(status_code=401, detail="Invalid credentials")
        
    session_id, csrf = security.create_session(username)
    session_sig = security.sign_session_id(session_id)
    
    # Detect if request came over HTTPS
    forwarded_proto = request.headers.get("X-Forwarded-Proto", "")
    is_secure = forwarded_proto.lower() == "https"
    request_origin = request.headers.get("Origin", "")
    is_cross_origin = bool(request_origin) and "localhost" not in request_origin
    
    samesite = "none" if (is_cross_origin or is_secure) else "strict"
    secure = True if (is_cross_origin or is_secure) else False
    
    response.set_cookie(
        key="session",
        value=session_id,
        max_age=config.SESSION_TTL_SEC,
        httponly=True,
        samesite=samesite,
        secure=secure,
        path="/"
    )
    response.set_cookie(
        key="session_sig",
        value=session_sig,
        max_age=config.SESSION_TTL_SEC,
        httponly=True,
        samesite=samesite,
        secure=secure,
        path="/"
    )
    
    logger.info("auth.login_success", user=username)
    logger.audit(
        event="user_login",
        user=username,
        operation="login",
        policy="ALLOW",
        status="success",
        duration_ms=0,
        source=request.client.host if request.client else "unknown"
    )
    return {"csrf": csrf}

@router.post("/logout")
@router.post("/v1/auth/logout")
async def logout(response: Response, session: str = Cookie(None)):
    if session:
        security.delete_session(session)
        
    response.delete_cookie("session", path="/")
    response.delete_cookie("session_sig", path="/")
    logger.info("auth.logout_success")
    logger.audit(
        event="user_logout",
        user="",
        operation="logout",
        policy="ALLOW",
        status="success",
        duration_ms=0
    )
    return {"ok": True}

@router.get("/get_profile")
@router.get("/v1/auth/profile")
async def get_profile(session_data: dict = Depends(get_current_session)):
    # Original server.py returns the current configured OS_WEBOS_USER
    return {"username": config.OS_WEBOS_USER}

@router.post("/profile")
@router.post("/v1/auth/profile")
async def update_profile(payload: ProfileUpdateRequest, session_data: dict = Depends(get_current_session)):
    new_user = payload.username.strip()
    new_pass = payload.password.strip()
    
    if not new_user or not new_pass:
        raise HTTPException(status_code=400, detail="Username and password cannot be empty")
        
    # Update configuration in memory
    config.OS_WEBOS_USER = new_user
    config.OS_WEBOS_PASS = new_pass
    
    # Persist to .env file
    try:
        env_path = ".env"
        lines = []
        if os.path.exists(env_path):
            with open(env_path, "r") as f:
                lines = f.readlines()
                
        user_set = False
        pass_set = False
        for i, line in enumerate(lines):
            if line.startswith("OS_WEBOS_USER="):
                lines[i] = f"OS_WEBOS_USER={new_user}\n"
                user_set = True
            elif line.startswith("OS_WEBOS_PASS="):
                lines[i] = f"OS_WEBOS_PASS={new_pass}\n"
                pass_set = True
                
        if not user_set:
            lines.append(f"OS_WEBOS_USER={new_user}\n")
        if not pass_set:
            lines.append(f"OS_WEBOS_PASS={new_pass}\n")
            
        with open(env_path, "w") as f:
            f.writelines(lines)
        logger.info("auth.profile_updated", user=new_user)
    except Exception as e:
        logger.error("auth", "update_profile_env", str(e))
        
    return {"ok": True, "username": new_user}
