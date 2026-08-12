import json
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from backend.core import db
from backend.core import logger

router = APIRouter()

class NoteRequest(BaseModel):
    content: str

class SettingsRequest(BaseModel):
    settings: dict

@router.get("/db/notes")
@router.get("/v1/database/notes")
async def get_notes():
    res = db.fetch_one("SELECT content FROM os_notes ORDER BY id DESC LIMIT 1")
    content = res[0] if res else ""
    return {"content": content}

@router.post("/db/notes")
@router.post("/v1/database/notes")
async def save_notes(payload: NoteRequest):
    success = db.execute("INSERT INTO os_notes (content) VALUES (%s)", (payload.content,))
    if not success:
        raise HTTPException(status_code=500, detail="Database operation failed")
    return {"success": True}

@router.get("/db/settings")
@router.get("/v1/database/settings")
async def get_settings():
    res = db.fetch_one("SELECT settings FROM os_settings ORDER BY id DESC LIMIT 1")
    settings = res[0] if res else {}
    return {"settings": settings}

@router.post("/db/settings")
@router.post("/v1/database/settings")
async def save_settings(payload: SettingsRequest):
    settings_str = json.dumps(payload.settings)
    success = db.execute("INSERT INTO os_settings (settings) VALUES (%s::jsonb)", (settings_str,))
    if not success:
        raise HTTPException(status_code=500, detail="Database operation failed")
    return {"success": True}
