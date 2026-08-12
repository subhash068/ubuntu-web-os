import os
from urllib.parse import urlparse

# Load env variables from .env if present (fallback helper for local non-docker runs)
def load_env_file(dotenv_path=".env"):
    if os.path.exists(dotenv_path):
        with open(dotenv_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip("'").strip('"')
                    if key not in os.environ:
                        os.environ[key] = val

load_env_file()

APP_ENV = os.environ.get("APP_ENV", "development")
APP_HOST = os.environ.get("APP_HOST", "0.0.0.0")
APP_PORT = int(os.environ.get("APP_PORT", "9500"))

# Database Configuration
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:manager@localhost:5432/ubuntu_web_os"
)

# Parse DATABASE_URL
parsed_db = urlparse(DATABASE_URL)
DB_USER = parsed_db.username or "postgres"
DB_PASS = parsed_db.password or "manager"
DB_HOST = parsed_db.hostname or "localhost"
DB_PORT = parsed_db.port or 5432
DB_NAME = parsed_db.path.lstrip("/") or "ubuntu_web_os"

# Session & Credentials
OS_WEBOS_USER = os.environ.get("OS_WEBOS_USER", "kali")
OS_WEBOS_PASS = os.environ.get("OS_WEBOS_PASS", "kali")
OS_WEBOS_SESSION_SECRET = os.environ.get("OS_WEBOS_SESSION_SECRET", "dev-change-me-secure-secret-key-123")
SESSION_TTL_SEC = int(os.environ.get("OS_WEBOS_SESSION_TTL_SEC", str(60 * 60 * 4)))  # 4h
OS_WEBOS_ALLOWED_ORIGIN = os.environ.get("OS_WEBOS_ALLOWED_ORIGIN", "")

# Security Limits
OS_WEBOS_RATE_LIMIT_MAX = int(os.environ.get("OS_WEBOS_RATE_LIMIT_MAX", "300"))
OS_WEBOS_RATE_LIMIT_WINDOW_SEC = int(os.environ.get("OS_WEBOS_RATE_LIMIT_WINDOW_SEC", "60"))
OS_WEBOS_MAX_REQUEST_BYTES = int(os.environ.get("OS_WEBOS_MAX_REQUEST_BYTES", str(64 * 1024)))
OS_WEBOS_MAX_JSON_BYTES = int(os.environ.get("OS_WEBOS_MAX_JSON_BYTES", str(64 * 1024)))
OS_WEBOS_MAX_STDOUT_BYTES = int(os.environ.get("OS_WEBOS_MAX_STDOUT_BYTES", str(32 * 1024)))
OS_WEBOS_MAX_STDERR_BYTES = int(os.environ.get("OS_WEBOS_MAX_STDERR_BYTES", str(16 * 1024)))
OS_WEBOS_MAX_TOTAL_RESPONSE_BYTES = int(os.environ.get("OS_WEBOS_MAX_TOTAL_RESPONSE_BYTES", str(80 * 1024)))

# Feature flags & Integrations
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
LIAE_ENABLED = os.environ.get("LIAE_ENABLED", "true").lower() == "true"
WAZUH_ENABLED = os.environ.get("WAZUH_ENABLED", "false").lower() == "true"
DOCKER_ENABLED = os.environ.get("DOCKER_ENABLED", "true").lower() == "true"
KUBERNETES_ENABLED = os.environ.get("KUBERNETES_ENABLED", "false").lower() == "true"
