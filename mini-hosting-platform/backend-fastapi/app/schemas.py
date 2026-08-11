from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict
from datetime import datetime

# --- Token Schemas ---
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None


# --- User Schemas ---
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str = Field(min_length=6)

class UserLogin(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    is_active: bool

    class Config:
        from_attributes = True


# --- Deployment Schemas ---
class DeploymentBase(BaseModel):
    domain: Optional[str] = None
    image_name: Optional[str] = None
    github_url: Optional[str] = None
    env: Optional[Dict[str, str]] = None
    replicas: Optional[int] = 1

class DeploymentCreate(DeploymentBase):
    pass

class DeploymentResponse(BaseModel):
    id: int
    domain: str
    container_id: str
    image_name: str
    target_addr: Optional[str] = None
    github_repo_url: Optional[str] = None
    created_at: datetime
    user_id: int

    class Config:
        from_attributes = True
