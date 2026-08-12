import subprocess
from fastapi import APIRouter, Response, status
from backend.core import config
from backend.core import db

router = APIRouter()

def check_db():
    try:
        res = db.fetch_one("SELECT 1")
        return "healthy" if res else "unhealthy"
    except Exception:
        return "unhealthy"

def check_linux():
    try:
        res = subprocess.run(
            ["wsl", "-d", "Ubuntu-24.04", "whoami"],
            capture_output=True, text=True, timeout=5
        )
        return "healthy" if res.returncode == 0 else "unhealthy"
    except Exception:
        return "unhealthy"

def check_docker():
    if not config.DOCKER_ENABLED:
        return "disabled"
    try:
        res = subprocess.run(
            ["wsl", "-d", "Ubuntu-24.04", "docker", "ps"],
            capture_output=True, text=True, timeout=5
        )
        return "healthy" if res.returncode == 0 else "unhealthy"
    except Exception:
        return "unhealthy"

def check_aws():
    from backend.services.aws import service
    return "available" if service.BOTO3_AVAILABLE else "unavailable"

def check_liae():
    if not config.LIAE_ENABLED:
        return "disabled"
    from backend.services.liae import service
    return "healthy" if service._collector_running else "degraded"

def check_wazuh():
    return "healthy" if config.WAZUH_ENABLED else "disabled"

@router.get("/health")
async def health():
    db_status = check_db()
    linux_status = check_linux()
    docker_status = check_docker()
    aws_status = check_aws()
    liae_status = check_liae()
    wazuh_status = check_wazuh()
    
    overall = "healthy"
    if db_status == "unhealthy" or linux_status == "unhealthy":
        overall = "unhealthy"
        
    return {
        "status": overall,
        "version": "2.0.0-dev",
        "services": {
            "database": db_status,
            "linux": linux_status,
            "docker": docker_status,
            "aws": aws_status,
            "liae": liae_status,
            "wazuh": wazuh_status
        }
    }

@router.get("/health/live")
async def live():
    return {"status": "alive"}

@router.get("/health/ready")
async def ready(response: Response):
    db_status = check_db()
    linux_status = check_linux()
    
    if db_status != "healthy" or linux_status != "healthy":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "not_ready", "db": db_status, "linux": linux_status}
        
    return {"status": "ready"}
