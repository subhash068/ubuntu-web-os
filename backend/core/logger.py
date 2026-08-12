import logging
import sys
from datetime import datetime, timezone

# Configure base logging to stdout
logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

logger = logging.getLogger("ubuntu_webos")

def get_utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def format_value(val) -> str:
    if val is None:
        return '""'
    s = str(val)
    if " " in s or "=" in s or '"' in s:
        # Escape quotes
        s_escaped = s.replace('"', '\\"')
        return f'"{s_escaped}"'
    return s

def info(operation: str, **kwargs):
    """
    Log info events:
    Timestamp INFO operation key=val key=val
    """
    timestamp = get_utc_timestamp()
    parts = [f"{timestamp} INFO {operation}"]
    for k, v in kwargs.items():
        parts.append(f"{k}={format_value(v)}")
    logger.info(" ".join(parts))

def error(service: str, operation: str, err: str, **kwargs):
    """
    Log error events:
    Timestamp ERROR service=service operation=operation error=err key=val
    """
    timestamp = get_utc_timestamp()
    parts = [
        f"{timestamp} ERROR",
        f"service={format_value(service)}",
        f"operation={format_value(operation)}",
        f"error={format_value(err)}"
    ]
    for k, v in kwargs.items():
        parts.append(f"{k}={format_value(v)}")
    logger.error(" ".join(parts))

def warn(operation: str, **kwargs):
    """Log warning events."""
    timestamp = get_utc_timestamp()
    parts = [f"{timestamp} WARN {operation}"]
    for k, v in kwargs.items():
        parts.append(f"{k}={format_value(v)}")
    logger.warning(" ".join(parts))

def audit(event: str, user: str, operation: str, policy: str, status: str, duration_ms: int, exit_code: int = 0, source: str = None):
    import json
    record = {
        "event": event,
        "user": user or "anonymous",
        "operation": operation,
        "policy": policy,
        "status": status,
        "duration_ms": duration_ms,
        "exit_code": exit_code,
        "source": source or "unknown"
    }
    logger.info(f"[AUDIT] {json.dumps(record)}")

