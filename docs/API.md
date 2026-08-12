# API Documentation

Ubuntu Web OS 2.0 exposes a clean, versioned control plane under `/api/v1/` alongside a legacy adapter layer.

---

## 1. Authentication (`/api/v1/auth`)

### Post Login
- **Endpoint**: `POST /api/v1/auth/login` (Legacy: `POST /api/login`)
- **Body**:
  ```json
  {
    "username": "admin",
    "password": "..."
  }
  ```
- **Returns**: `{"csrf": "..."}` and sets `session` and `session_sig` cookies.

### Post Logout
- **Endpoint**: `POST /api/v1/auth/logout` (Legacy: `POST /api/logout`)
- **Returns**: `{"ok": true}` and clears cookies.

### Get Profile
- **Endpoint**: `GET /api/v1/auth/profile` (Legacy: `GET /api/get_profile`)
- **Headers**: `X-CSRF-Token`
- **Returns**: `{"username": "admin"}`

---

## 2. Database Services (`/api/v1/database`)

### Get Notes
- **Endpoint**: `GET /api/v1/database/notes` (Legacy: `GET /api/db/notes`)
- **Returns**: `{"content": "..."}`

### Save Notes
- **Endpoint**: `POST /api/v1/database/notes` (Legacy: `POST /api/db/notes`)
- **Body**: `{"content": "..."}`
- **Returns**: `{"success": true}`

### Get Settings
- **Endpoint**: `GET /api/v1/database/settings` (Legacy: `GET /api/db/settings`)
- **Returns**: `{"settings": {...}}`

### Save Settings
- **Endpoint**: `POST /api/v1/database/settings` (Legacy: `POST /api/db/settings`)
- **Body**: `{"settings": {...}}`
- **Returns**: `{"success": true}`

---

## 3. System Shell Commands (`/api/v1/system`)

### Command Execution
- **Endpoint**: `POST /api/v1/system/command` (Legacy: `POST /api/command`)
- **Headers**: `X-CSRF-Token`
- **Body**:
  ```json
  {
    "op": "run_raw",
    "args": {
      "command": "whoami"
    }
  }
  ```
- **Returns**:
  ```json
  {
    "status": "success",
    "stdout": "root\n",
    "stderr": "",
    "exit_code": 0,
    "truncated_stdout": false,
    "truncated_stderr": false
  }
  ```

---

## 4. AWS DevOps Integration (`/api/v1/aws`)

### AWS Actions
- **Endpoint**: `POST /api/v1/aws/command`
- **Headers**: `X-CSRF-Token`
- **Body**:
  ```json
  {
    "op": "aws_instances_list",
    "args": {}
  }
  ```
- **Returns**: List of instances and statuses.

---

## 5. Live Autopsy Diagnostics Engine (`/api/v1/liae`)

### Timeline Snapshots
- **Endpoint**: `POST /api/v1/liae/command`
- **Headers**: `X-CSRF-Token`
- **Body**:
  ```json
  {
    "op": "liae_timeline",
    "args": {}
  }
  ```
- **Returns**: Chronology records.

---

## 6. Health Checks (`/api/health`)

- **Liveness Probe**: `GET /api/health/live` (Checks Web OS process status, returns `{"status": "alive"}`).
- **Readiness Probe**: `GET /api/health/ready` (Checks PostgreSQL and WSL responsiveness, returns `200 OK` or `503 Service Unavailable`).
- **Comprehensive health status**: `GET /api/health` (Provides detailed service health metadata).
