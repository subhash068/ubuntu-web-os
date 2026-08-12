# Security Architecture Documentation

This document describes the security controls and policies implemented in Ubuntu Web OS 2.0.

---

## 1. Authentication and Session Management
- **Cookies-based Session**: Successful logins issue `session` and `session_sig` cookies.
- **HMAC Signatures**: Sessions are signed using HMAC-SHA256 with a unique `OS_WEBOS_SESSION_SECRET` loaded from configuration. Every request to protected API routes validates that the signature matches, protecting against session cookie hijacking and modifications.
- **Expiration TTL**: Sessions have a configurable lifetime (`OS_WEBOS_SESSION_TTL_SEC`), defaulting to 4 hours, after which they are automatically invalidated.

---

## 2. Cross-Site Request Forgery (CSRF) Protection
- **CSRF Tokens**: Upon successful login, the API issues a CSRF token in the JSON response body.
- **Verification**: Protected routes (e.g. `/api/v1/system/command`) require this token to be sent in the `X-CSRF-Token` header. The server compares the provided token with the current active session in the database, rejecting mismatching requests with HTTP 403 Forbidden.

---

## 3. Rate Limiting
- **IP-Based Rates**: Clients are tracked by IP address. The rate limiter tracks execution calls over a sliding time window.
- **Configurable Limits**:
  - `OS_WEBOS_RATE_LIMIT_MAX` (Default: 300 requests)
  - `OS_WEBOS_RATE_LIMIT_WINDOW_SEC` (Default: 60 seconds)
- **Rejection**: Violations result in HTTP 429 Too Many Requests.

---

## 4. Size & Bounds Restrictions
- **Request Body Limits**: FastAPI middleware inspects the `Content-Length` header of incoming requests. Requests exceeding `OS_WEBOS_MAX_REQUEST_BYTES` (64 KB by default) are immediately rejected with **HTTP 413 (Payload Too Large)** to protect against memory exhaustion attacks.
- **WSL Output Limits**: Subprocess stdout and stderr are truncated using the configured bytes thresholds (`OS_WEBOS_MAX_STDOUT_BYTES` and `OS_WEBOS_MAX_STDERR_BYTES`), preventing buffer memory leakage.

---

## 5. Command Policy Enforcement
All commands are inspected by the Command Policy Engine before execution in WSL:
- **ALLOW**: Safe diagnostics and reads (e.g. `ls`, `pwd`, `df -h`) execute immediately.
- **REQUIRE CONFIRMATION**: State-changing setups (e.g. `apt install`, container actions) trigger a confirmation requirement return. The command is executed only if confirmed is explicitly set to true.
- **DENY**: High-risk actions (e.g. `rm -rf /`, `reboot`) are blocked.
- **Audit Logging**: Successful execution, block events, and exceptions are logged into JSON formatted audit entries.
