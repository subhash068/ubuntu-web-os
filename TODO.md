## Security hardening plan (high priority)

- [x] Update `server.py`
  - [x] Add session-based authentication: `POST /api/login` (+ optional `POST /api/logout`)
  - [x] Add CSRF protection for state-changing requests (header `X-CSRF-Token`)
  - [x] Add rate limiting per client IP for execution endpoint
  - [x] Add request size limits and strict JSON parsing
  - [x] Replace dangerous `bash -c` execution with structured `op` allowlist mapped to safe argv
  - [x] Add stdout/stderr output truncation and “truncated” indicators

- [x] Update `index.html`
  - [x] Add login modal (username/password)
  - [x] Ensure app loads and triggers login before using backend

- [x] Update `app.js`
  - [x] Add login flow + CSRF token handling
  - [x] Replace all `fetch(.../api/execute, {command: ...})` calls with `/api/command` structured payloads
  - [x] Gate initialization until authenticated
  - [x] Display “Output truncated” indicator when server truncates output

- [x] Validate behavior
  - [x] Unauthenticated -> 401
  - [x] Missing CSRF -> 403
  - [x] Rate limit -> 429
  - [x] Disallowed ops -> 400
  - [x] Large outputs truncated with indicator

