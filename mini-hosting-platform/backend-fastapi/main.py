import os
import shutil
import socket
import tempfile
import zipfile
import httpx
import logging
from typing import List, Dict, Optional
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

logger = logging.getLogger("main")

from app.database import engine, Base, get_db
from app.models import User, Deployment
from app.schemas import UserCreate, UserResponse, Token, DeploymentCreate, DeploymentResponse
from app.auth import get_password_hash, verify_password, create_access_token, get_current_user
from app.docker_manager import DockerManager
from app.git_manager import GitManager
from app.nginx_manager import NginxManager

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Mini Hosting Platform API", version="1.0.0")

# Enable CORS for frontend dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize manager utilities
docker_mgr = DockerManager()
git_mgr = GitManager()
nginx_mgr = NginxManager()

# Cache server's public IP
SERVER_IP = os.getenv("SERVER_IP", "127.0.0.1")
try:
    # Try fetching public IP
    with httpx.Client(timeout=3.0) as client:
        r = client.get("https://api.ipify.org?format=json")
        if r.status_code == 200:
            SERVER_IP = r.json().get("ip", SERVER_IP)
except Exception:
    pass

# --- AUTH ENDPOINTS ---

@app.post("/api/auth/register", response_model=UserResponse)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user_in.email).first()
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    hashed_pwd = get_password_hash(user_in.password)
    new_user = User(email=user_in.email, hashed_password=hashed_pwd)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/api/auth/login", response_model=Token)
def login(user_in: UserCreate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user or not verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


# --- SYSTEM/DNS ENDPOINTS ---

@app.get("/api/system/ip")
def get_system_ip():
    return {"ip": SERVER_IP}

@app.get("/api/dns/check/{domain}")
def check_dns(domain: str):
    try:
        # Resolve A records
        ips = []
        try:
            addr_info = socket.getaddrinfo(domain, None)
            ips = list(set([info[4][0] for info in addr_info]))
        except socket.gaierror:
            pass

        points_to_me = SERVER_IP in ips or "127.0.0.1" in ips or "localhost" in domain
        return {
            "domain": domain,
            "resolvedIPs": ips,
            "serverIP": SERVER_IP,
            "pointsToMe": points_to_me
        }
    except Exception as e:
        return {"error": f"Failed to check DNS: {str(e)}", "pointsToMe": False}


# --- DEPLOYMENT ENDPOINTS ---

@app.get("/api/deployments", response_model=List[DeploymentResponse])
def list_deployments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # List all deployments belonging to the user
    return db.query(Deployment).filter(Deployment.user_id == current_user.id).all()

@app.post("/api/deploy", response_model=DeploymentResponse)
def deploy_app(req: DeploymentCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # 1. Determine target domain
    domain = req.domain.strip() if req.domain else f"app-{int(tempfile.tempdir or 1000)}.{os.getenv('BASE_DOMAIN', 'localhost')}"
    
    # 2. Check duplicate domains
    old_dep = db.query(Deployment).filter(Deployment.domain == domain).first()
    if old_dep:
        # Stop and remove old container group
        for cid in old_dep.container_id.split(","):
            if cid.strip():
                docker_mgr.stop_container(cid.strip())
        # Remove old nginx configuration mapping
        try:
            nginx_mgr.remove_site(domain)
        except Exception:
            pass
        # Delete from DB
        db.delete(old_dep)
        db.commit()

    # 3. Git integration or standard image setup
    image_to_run = req.image_name
    if req.github_url:
        temp_dir = tempfile.mkdtemp(prefix="git-build-")
        try:
            git_mgr.clone(req.github_url, temp_dir)
            image_name = f"git-{domain.replace('.', '-')}"
            docker_mgr.build_image(temp_dir, image_name)
            image_to_run = image_name
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to build git repository: {str(e)}"
            )
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    if not image_to_run:
        image_to_run = "nginx:alpine" # default fallback image

    # 4. Spin up container replicas
    container_ids = []
    target_addresses = []
    replicas = req.replicas or 1
    if replicas <= 0:
        replicas = 1
        
    try:
        for i in range(replicas):
            cid, taddr = docker_mgr.run_container(image_to_run, req.env)
            container_ids.append(cid)
            target_addresses.append(taddr)
    except Exception as e:
        # Cleanup any partially created containers
        for cid in container_ids:
            docker_mgr.stop_container(cid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to spin up container replica: {str(e)}"
        )

    joined_cids = ",".join(container_ids)
    # For load balancing, we'll select the first replica address for now, 
    # or let Nginx route to the round-robin IP group if multiple targets are supported.
    # We will write the Nginx routing rule using the first target address or pass it along.
    joined_addrs = ",".join(target_addresses)
    primary_addr = target_addresses[0]

    # 5. Configure dynamic Nginx reverse proxy
    try:
        nginx_mgr.add_site(domain, primary_addr)
    except Exception as e:
        # Cleanup containers on routing failure
        for cid in container_ids:
            docker_mgr.stop_container(cid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to configure Nginx routing: {str(e)}"
        )

    # 6. Persist to PostgreSQL database
    new_deployment = Deployment(
        domain=domain,
        container_id=joined_cids,
        image_name=image_to_run,
        target_addr=joined_addrs,
        github_repo_url=req.github_url,
        user_id=current_user.id
    )
    db.add(new_deployment)
    db.commit()
    db.refresh(new_deployment)
    
    # Request Let's Encrypt certificate in background
    background_tasks.add_task(nginx_mgr.configure_ssl, domain)
    
    return new_deployment

@app.delete("/api/deployments/{domain}")
def delete_deployment(domain: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    dep = db.query(Deployment).filter(Deployment.domain == domain, Deployment.user_id == current_user.id).first()
    if not dep:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Deployment not found"
        )
    # Stop all container replicas
    for cid in dep.container_id.split(","):
        if cid.strip():
            docker_mgr.stop_container(cid.strip())
            
    # Remove nginx routing rule
    try:
        nginx_mgr.remove_site(domain)
    except Exception:
        pass

    db.delete(dep)
    db.commit()
    return {"message": f"Successfully deleted deployment for domain {domain}"}

@app.get("/api/logs/{container_id}")
def get_logs(container_id: str, current_user: User = Depends(get_current_user)):
    try:
        logs = docker_mgr.get_container_logs(container_id)
        return {"logs": logs}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve container logs: {str(e)}"
        )

@app.post("/api/upload")
def upload_and_build(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must be a zip archive containing a Dockerfile"
        )
        
    temp_zip = tempfile.mktemp(suffix=".zip")
    temp_dir = tempfile.mkdtemp(prefix="zip-build-")
    
    try:
        with open(temp_zip, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        with zipfile.ZipFile(temp_zip, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
            
        # Verify Dockerfile exists
        if not os.path.exists(os.path.join(temp_dir, "Dockerfile")):
            raise Exception("ZIP archive does not contain a Dockerfile in the root path")
            
        image_name = f"upload-{int(tempfile.tempdir or 1000)}"
        docker_mgr.build_image(temp_dir, image_name)
        
        return {"imageName": image_name}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to build uploaded archive: {str(e)}"
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        if os.path.exists(temp_zip):
            os.remove(temp_zip)


# --- WEBSOCKETS LOGS CONSOLE ---

@app.websocket("/ws/logs/{container_id}")
async def websocket_logs(websocket: WebSocket, container_id: str):
    await websocket.accept()
    try:
        # Send initial logs
        initial_logs = docker_mgr.get_container_logs(container_id)
        await websocket.send_text(f"--- Container Logs for {container_id[:12]} ---")
        await websocket.send_text(initial_logs)
        
        # Simple keep alive and monitoring loop
        while True:
            # We can expand this to tail container logs or send status notifications
            # For this MVP, we await client incoming messages or keep connection alive
            data = await websocket.receive_text()
            # Echo or process commands if needed
            await websocket.send_text(f"Heartbeat received: {data}")
    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected for container {container_id}")
    except Exception as e:
        try:
            await websocket.send_text(f"Error: {str(e)}")
        except Exception:
            pass


# --- GITHUB WEBHOOK REDEPLOYMENT TASK ---

def run_redeploy_task(github_url: str, db_session_factory):
    db = db_session_factory()
    try:
        deployments = db.query(Deployment).filter(Deployment.github_repo_url == github_url).all()
        for dep in deployments:
            logger.info(f"Triggering automated webhook redeployment for {dep.domain}")
            
            temp_dir = tempfile.mkdtemp(prefix="git-build-")
            try:
                git_mgr.clone(github_url, temp_dir)
                image_name = f"git-{dep.domain.replace('.', '-')}"
                docker_mgr.build_image(temp_dir, image_name)
            except Exception as e:
                logger.error(f"Failed to build webhook image for {dep.domain}: {e}")
                continue
            finally:
                shutil.rmtree(temp_dir, ignore_errors=True)

            try:
                old_cids = [c.strip() for c in dep.container_id.split(",") if c.strip()]
                replicas = len(old_cids) if old_cids else 1
                
                new_cids = []
                new_addrs = []
                for _ in range(replicas):
                    cid, taddr = docker_mgr.run_container(image_name, env=None)
                    new_cids.append(cid)
                    new_addrs.append(taddr)

                # Swap Nginx config
                primary_addr = new_addrs[0]
                nginx_mgr.add_site(dep.domain, primary_addr)

                # Stop old containers (Zero-Downtime Swap)
                for old_cid in old_cids:
                    docker_mgr.stop_container(old_cid)

                # Update Database entry
                dep.container_id = ",".join(new_cids)
                dep.target_addr = ",".join(new_addrs)
                dep.image_name = image_name
                db.commit()

                # Request SSL certificate update
                nginx_mgr.configure_ssl(dep.domain)
                logger.info(f"Webhook redeployment successful for {dep.domain}")
            except Exception as e:
                logger.error(f"Failed to complete swap for {dep.domain}: {e}")
    finally:
        db.close()

@app.post("/api/webhook/github")
async def github_webhook(payload: dict, background_tasks: BackgroundTasks):
    repo_url = payload.get("repository", {}).get("html_url")
    if not repo_url:
        repo_url = payload.get("repository", {}).get("clone_url")
    
    if not repo_url:
        raise HTTPException(status_code=400, detail="Invalid GitHub payload")

    from app.database import SessionLocal
    background_tasks.add_task(run_redeploy_task, repo_url, SessionLocal)
    return {"message": "Github push webhook received. Redeployment triggered in background."}


# --- GITHUB WEBHOOK REDEPLOYMENT TASK ---

# In-memory stores for mock states
MOCK_BUCKETS = [
    {"name": "production-assets", "region": "us-east-1", "files_count": 28, "size_mb": 142.4},
    {"name": "user-uploads-bucket", "region": "us-west-2", "files_count": 812, "size_mb": 2450.8},
]

MOCK_DATABASES = [
    {"name": "agenthoryx-pg-prod", "type": "PostgreSQL 15", "status": "running", "size_mb": 88.4},
    {"name": "session-store-redis", "type": "Redis 7", "status": "running", "size_mb": 12.1},
]

MOCK_FUNCTIONS = [
    {"name": "stripe-webhook-handler", "trigger": "HTTP", "status": "active", "invocations_count": 1420},
    {"name": "daily-report-cron", "trigger": "Cron", "status": "active", "invocations_count": 24},
]

@app.get("/api/storage/buckets")
def list_buckets(current_user: User = Depends(get_current_user)):
    return MOCK_BUCKETS

@app.post("/api/storage/buckets")
def create_bucket(payload: dict, current_user: User = Depends(get_current_user)):
    name = payload.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="Bucket name required")
    new_bucket = {"name": name, "region": "us-east-1", "files_count": 0, "size_mb": 0.0}
    MOCK_BUCKETS.append(new_bucket)
    return new_bucket

@app.delete("/api/storage/buckets/{name}")
def delete_bucket(name: str, current_user: User = Depends(get_current_user)):
    global MOCK_BUCKETS
    MOCK_BUCKETS = [b for b in MOCK_BUCKETS if b["name"] != name]
    return {"message": f"Bucket {name} deleted"}

@app.get("/api/databases")
def list_databases(current_user: User = Depends(get_current_user)):
    return MOCK_DATABASES

@app.post("/api/databases")
def create_database(payload: dict, current_user: User = Depends(get_current_user)):
    name = payload.get("name")
    db_type = payload.get("type", "PostgreSQL 15")
    if not name:
        raise HTTPException(status_code=400, detail="Database name required")
    new_db = {"name": name, "type": db_type, "status": "running", "size_mb": 0.0}
    MOCK_DATABASES.append(new_db)
    return new_db

@app.delete("/api/databases/{name}")
def delete_database(name: str, current_user: User = Depends(get_current_user)):
    global MOCK_DATABASES
    MOCK_DATABASES = [d for d in MOCK_DATABASES if d["name"] != name]
    return {"message": f"Database {name} deleted"}

@app.get("/api/functions")
def list_functions(current_user: User = Depends(get_current_user)):
    return MOCK_FUNCTIONS

@app.post("/api/functions")
def create_function(payload: dict, current_user: User = Depends(get_current_user)):
    name = payload.get("name")
    trigger = payload.get("trigger", "HTTP")
    if not name:
        raise HTTPException(status_code=400, detail="Function name required")
    new_fn = {"name": name, "trigger": trigger, "status": "active", "invocations_count": 0}
    MOCK_FUNCTIONS.append(new_fn)
    return new_fn

@app.get("/api/monitoring/stats")
def get_monitoring_stats(current_user: User = Depends(get_current_user)):
    import random
    return {
        "cpu_usage": round(random.uniform(5.0, 45.0), 1),
        "ram_usage": round(random.uniform(20.0, 65.0), 1),
        "bandwidth_gb": round(random.uniform(10.0, 150.0), 2),
        "storage_usage": 14.5,
        "database_usage": 100.5,
        "monthly_requests": 28540,
        "active_users": random.randint(12, 180),
        "ssl_certificates": len(MOCK_DATABASES) + 2,
    }

@app.post("/api/ai/chat")
def ai_chat(payload: dict, current_user: User = Depends(get_current_user)):
    prompt = payload.get("prompt", "").lower()
    
    if "deploy" in prompt or "project" in prompt:
        response_text = "I recommend importing your repository directly on the Dashboard. I can monitor container creation and map custom domains with SSL for you once it builds."
    elif "db" in prompt or "database" in prompt:
        response_text = "I suggest provisioning a Managed PostgreSQL database in the Databases panel. I can configure connection pools and optimize queries automatically."
    elif "storage" in prompt or "bucket" in prompt:
        response_text = "You can create an Object Storage bucket in the Storage tab to store static assets. I will automatically attach a Cloudflare CDN edge route."
    else:
        response_text = "Hello! I am the Agenthoryx AI Copilot. I can help you monitor server health, deploy new microservices, configure databases, or manage certificates."
        
    return {"reply": response_text}
