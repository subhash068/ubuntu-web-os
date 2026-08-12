# Development Guide

This guide details the setup and development workflows for Ubuntu Web OS 2.0.

---

## 🛠️ Prerequisites
- Python 3.11+
- Node.js 18+ (for E2E browser tests)
- PostgreSQL database
- WSL (Ubuntu-24.04) running on Windows

---

## 🚀 Setup & Local Execution

### 1. Environment Settings
Copy the `.env.example` to `.env` and fill in local credentials:
```bash
cp .env.example .env
```

### 2. Install Python Dependencies
```bash
pip install fastapi uvicorn pg8000 pytest httpx
```

### 3. Initialize Node (for Playwright E2E tests)
```bash
npm install
npx playwright install
```

### 4. Start the Application Control Plane
Run the FastAPI application locally:
```bash
uvicorn backend.api.main:app --port 9500 --reload
```
You can access the Web Desktop interface at `http://localhost:9500`.

---

## 🧪 Testing Workflows

### 1. Execute Backend Pytest
Run the test suite containing configurations, rate limiting, and component integration tests:
```bash
pytest
```

### 2. Execute Playwright E2E tests
Runs the Playwright browser tests. It automatically starts and stops the local uvicorn server:
```bash
npx playwright test --workers=1
```

---

## 🐳 Running inside Docker Compose

Launch the complete ecosystem (FastAPI, Redis, PostgreSQL, Prometheus, Grafana):
```bash
docker compose up --build
```
- **Web Desktop**: `http://localhost:9500`
- **Prometheus Dashboard**: `http://localhost:9090`
- **Grafana Visualization**: `http://localhost:3000` (Default Credentials: `admin` / `admin`)
