import subprocess
from fastapi import APIRouter, Request, HTTPException, Cookie, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from backend.core import security
from backend.core import logger
from backend.services.command.service import execute_command
from backend.services.command.proxy import handle_fastapi_proxy

router = APIRouter()

class CommandRequest(BaseModel):
    op: str
    args: dict

class V1CommandRequest(BaseModel):
    op: str
    args: dict

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
        
    # Enforce CSRF token verification
    csrf_token = request.headers.get("X-CSRF-Token", "")
    if not csrf_token or not security.validate_csrf(csrf_token, sess["csrf"]):
        raise HTTPException(status_code=403, detail="Invalid CSRF token")
        
    return sess

# ── Legacy compatibility endpoints ──────────────────────────────────

@router.post("/command")
async def legacy_command(
    payload: CommandRequest,
    request: Request,
    session_data: dict = Depends(get_current_session)
):
    # Rate limit check
    client_ip = request.client.host if request.client else "unknown"
    if security.rate_limit_check(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    op = payload.op
    args = payload.args
    user = session_data.get("user")

    # Dispatch to AWS service
    if op.startswith("aws_"):
        try:
            from backend.services.aws.service import handle_aws_api
            return handle_aws_api(op, args)
        except Exception as e:
            logger.error("aws", op, str(e))
            raise HTTPException(status_code=500, detail=f"AWS Module Error: {str(e)}")

    # Dispatch to LIAE service
    if op.startswith("liae_"):
        try:
            from backend.services.liae.service import handle_liae_api
            return handle_liae_api(op, args)
        except Exception as e:
            logger.error("liae", op, str(e))
            raise HTTPException(status_code=500, detail=f"LIAE Module Error: {str(e)}")

    # Standard command execution
    result = execute_command(op, args, user=user)
    return result

@router.post("/command_stream")
async def legacy_command_stream(
    payload: CommandRequest,
    request: Request,
    session_data: dict = Depends(get_current_session)
):
    client_ip = request.client.host if request.client else "unknown"
    if security.rate_limit_check(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    op = payload.op
    args = payload.args

    if op != "run_raw":
        raise HTTPException(status_code=400, detail="Only run_raw supported for streaming")

    command = args.get("command")
    if not command:
        raise HTTPException(status_code=400, detail="Missing command")

    command = f"export DEBIAN_FRONTEND=noninteractive; {command}"
    argv = ["bash", "-c", command]

    def generate_output():
        proc = None
        try:
            proc = subprocess.Popen(
                ["wsl", "-d", "Ubuntu-24.04", "-u", "root", "--cd", "~"] + argv,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            for line in iter(proc.stdout.readline, ""):
                yield line
        except Exception as e:
            yield f"Error: {str(e)}\n"
        finally:
            if proc:
                try:
                    proc.stdout.close()
                except:
                    pass
                try:
                    proc.terminate()
                    proc.wait(timeout=2)
                except:
                    try:
                        proc.kill()
                    except:
                        pass

    return StreamingResponse(generate_output(), media_type="text/plain")


# ── API v1 endpoints ───────────────────────────────────────────────

@router.post("/v1/system/command")
async def v1_system_command(
    payload: V1CommandRequest,
    request: Request,
    session_data: dict = Depends(get_current_session)
):
    # Enforces structured policy validation
    client_ip = request.client.host if request.client else "unknown"
    if security.rate_limit_check(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
        
    return execute_command(payload.op, payload.args, user=session_data.get("user"))

@router.post("/v1/aws/command")
async def v1_aws_command(
    payload: V1CommandRequest,
    request: Request,
    session_data: dict = Depends(get_current_session)
):
    client_ip = request.client.host if request.client else "unknown"
    if security.rate_limit_check(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    from backend.services.aws.service import handle_aws_api
    return handle_aws_api(payload.op, payload.args)

@router.post("/v1/liae/command")
async def v1_liae_command(
    payload: V1CommandRequest,
    request: Request,
    session_data: dict = Depends(get_current_session)
):
    client_ip = request.client.host if request.client else "unknown"
    if security.rate_limit_check(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    from backend.services.liae.service import handle_liae_api
    return handle_liae_api(payload.op, payload.args)



# ── Sandbox HTTP Proxy endpoints ───────────────────────────────────

@router.get("/proxy/{scheme}/{target_url:path}")
@router.post("/proxy/{scheme}/{target_url:path}")
async def proxy_path(scheme: str, target_url: str, request: Request):
    if scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid scheme")
        
    # Append query string if present
    full_url = f"{scheme}://{target_url}"
    if request.url.query:
        full_url += f"?{request.url.query}"
        
    # Read body if POST
    if request.method in ("POST", "PUT", "PATCH"):
        request._body = await request.body()
        
    return handle_fastapi_proxy(request, full_url, method=request.method)

@router.get("/api/proxy")
@router.post("/api/proxy")
async def proxy_query(url: str, request: Request):
    if not url:
        raise HTTPException(status_code=400, detail="Missing url parameter")
        
    if request.method in ("POST", "PUT", "PATCH"):
        request._body = await request.body()
        
    return handle_fastapi_proxy(request, url, method=request.method)
