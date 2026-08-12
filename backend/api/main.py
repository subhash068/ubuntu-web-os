import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from backend.core import config
from backend.core import logger
from backend.core.db import init_db
from backend.services.liae.service import start_collector, stop_collector
from backend.api.routes import auth, db as db_routes, system, health

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup lifecycle
    logger.info("application.startup", env=config.APP_ENV)
    
    # Initialize database tables
    init_db()
    
    # Start LIAE background diagnostics collector if enabled
    if config.LIAE_ENABLED:
        start_collector()
        logger.info("application.startup", liae="started")
        
    yield
    
    # Shutdown lifecycle
    logger.info("application.shutdown", status="started")
    if config.LIAE_ENABLED:
        stop_collector()
        logger.info("application.shutdown", liae="stopped")
    logger.info("application.shutdown", status="completed")

app = FastAPI(
    title="Ubuntu Web OS Control Plane",
    version="2.0.0-dev",
    lifespan=lifespan
)

# CORS Middleware (mirrors the dynamic credential origin echo in legacy server.py)
@app.middleware("http")
async def cors_handler(request: Request, call_next):
    # Handle preflight options requests directly
    if request.method == "OPTIONS":
        response = Response()
    else:
        response = await call_next(request)
        
    # Get Origin from request
    static_origin = config.OS_WEBOS_ALLOWED_ORIGIN.strip()
    request_origin = request.headers.get("Origin", "")
    origin = static_origin if static_origin else request_origin
    
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
        
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-CSRF-Token"
    
    return response

# Enforce Request Payload Limit Middleware
@app.middleware("http")
async def request_limit_handler(request: Request, call_next):
    # Read Content-Length
    content_length = request.headers.get("Content-Length")
    if content_length:
        try:
            length = int(content_length)
            if length > config.OS_WEBOS_MAX_REQUEST_BYTES:
                return Response(
                    content='{"error": "Request too large"}',
                    status_code=413,
                    media_type="application/json"
                )
        except ValueError:
            pass
            
    response = await call_next(request)
    return response

# Include route groups
app.include_router(auth.router, prefix="/api")
app.include_router(db_routes.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(health.router, prefix="/api")

# Static files / Web OS page routes
@app.get("/")
@app.get("/index.html")
async def get_index():
    index_path = os.path.abspath("frontend/desktop/index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return Response("index.html not found", status_code=404)

@app.get("/favicon.ico")
async def get_favicon():
    fav_path = os.path.abspath("frontend/desktop/favicon.ico")
    if os.path.exists(fav_path):
        return FileResponse(fav_path)
    return Response("favicon not found", status_code=404)

# Mount static folder segments
app.mount("/desktop", StaticFiles(directory="frontend/desktop"), name="desktop")
app.mount("/apps", StaticFiles(directory="frontend/apps"), name="apps")
