import json
import os
import hmac
import time
import secrets
import subprocess
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urljoin
import pg8000.dbapi
from browser import handle_proxy_request

# =============== Database config ===============
DB_HOST = os.environ.get('OS_WEBOS_DB_HOST', 'localhost')
DB_PORT = os.environ.get('OS_WEBOS_DB_PORT', '5432')
DB_USER = os.environ.get('OS_WEBOS_DB_USER', 'postgres')
DB_PASS = os.environ.get('OS_WEBOS_DB_PASS', 'manager')
DB_NAME = os.environ.get('OS_WEBOS_DB_NAME', 'ubuntu_web_os')

def get_db_connection():
    try:
        conn = pg8000.dbapi.connect(
            host=DB_HOST,
            port=int(DB_PORT),
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        return conn
    except Exception as e:
        print(f"Warning: Database connection failed. {e}")
        return None

def init_db():
    conn = get_db_connection()
    if conn:
        try:
            cur = conn.cursor()
            # Create table for notes
            cur.execute("""
                CREATE TABLE IF NOT EXISTS os_notes (
                    id SERIAL PRIMARY KEY,
                    content TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Create table for settings (windows layout, background, etc)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS os_settings (
                    id SERIAL PRIMARY KEY,
                    settings JSONB NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Create table for sessions
            cur.execute("""
                CREATE TABLE IF NOT EXISTS os_sessions (
                    session_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    csrf TEXT NOT NULL,
                    exp FLOAT NOT NULL
                )
            """)
            # Ensure at least one row exists for each
            cur.execute("SELECT COUNT(*) FROM os_notes")
            if cur.fetchone()[0] == 0:
                cur.execute("INSERT INTO os_notes (content) VALUES ('')")
            
            cur.execute("SELECT COUNT(*) FROM os_settings")
            if cur.fetchone()[0] == 0:
                cur.execute("INSERT INTO os_settings (settings) VALUES ('{}'::jsonb)")
            conn.commit()
            conn.commit()
            cur.close()
            print("Database initialized successfully.")
        except Exception as e:
            print(f"Failed to initialize tables: {e}")
            conn.rollback()
        finally:
            conn.close()

# Initialize tables on startup
init_db()

# =============== Security config ===============
SESSION_SECRET = os.environ.get('OS_WEBOS_SESSION_SECRET', 'dev-change-me')
SESSION_USER = os.environ.get('OS_WEBOS_USER', 'kali')
SESSION_PASS = os.environ.get('OS_WEBOS_PASS', 'kali')

# If you want to restrict CORS to a specific origin, set OS_WEBOS_ALLOWED_ORIGIN
ALLOWED_ORIGIN = os.environ.get('OS_WEBOS_ALLOWED_ORIGIN', '')

# Rate limit per IP (requests per minute)
RATE_LIMIT_MAX = int(os.environ.get('OS_WEBOS_RATE_LIMIT_MAX', '300'))
RATE_LIMIT_WINDOW_SEC = int(os.environ.get('OS_WEBOS_RATE_LIMIT_WINDOW_SEC', '60'))

# Request limits
MAX_REQUEST_BYTES = int(os.environ.get('OS_WEBOS_MAX_REQUEST_BYTES', str(64 * 1024)))
MAX_JSON_BYTES = int(os.environ.get('OS_WEBOS_MAX_JSON_BYTES', str(64 * 1024)))

# Output limits
MAX_STDOUT_BYTES = int(os.environ.get('OS_WEBOS_MAX_STDOUT_BYTES', str(32 * 1024)))
MAX_STDERR_BYTES = int(os.environ.get('OS_WEBOS_MAX_STDERR_BYTES', str(16 * 1024)))
MAX_TOTAL_RESPONSE_BYTES = int(os.environ.get('OS_WEBOS_MAX_TOTAL_RESPONSE_BYTES', str(80 * 1024)))

# Session lifetime
SESSION_TTL_SEC = int(os.environ.get('OS_WEBOS_SESSION_TTL_SEC', str(60 * 60 * 4)))  # 4h

# =============== In-memory stores ===============
# Note: this is fine for a single-process deployment.
SESSIONS = {}  # session_id -> {user, csrf, exp}
RATE = {}      # ip -> [(timestamp, ...)]

# =============== Helpers ===============
def _json_response(handler, status_code: int, payload: dict):
    body = json.dumps(payload).encode('utf-8')
    if len(body) > MAX_TOTAL_RESPONSE_BYTES:
        payload = {'error': 'Response too large'}
        body = json.dumps(payload).encode('utf-8')

    handler.send_response(status_code)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

def _read_limited_json(handler):
    try:
        content_length = int(handler.headers.get('Content-Length', '0') or '0')
    except ValueError:
        content_length = 0
    if content_length <= 0:
        return None
    if content_length > MAX_REQUEST_BYTES:
        return {'__error__': 'Request too large'}

    raw = handler.rfile.read(content_length)
    if len(raw) > MAX_JSON_BYTES:
        return {'__error__': 'JSON too large'}

    try:
        return json.loads(raw.decode('utf-8'))
    except Exception:
        return {'__error__': 'Invalid JSON'}

def _get_cookie(handler, name: str):
    cookie = handler.headers.get('Cookie', '')
    parts = cookie.split(';')
    for p in parts:
        p = p.strip()
        if p.startswith(name + '='):
            return p[len(name) + 1:]
    return ''

def _sign_session_id(session_id: str) -> str:
    mac = hmac.new(SESSION_SECRET.encode('utf-8'), session_id.encode('utf-8'), digestmod='sha256').hexdigest()
    return mac

def _new_session(user: str):
    session_id = secrets.token_urlsafe(24)
    csrf = secrets.token_urlsafe(24)
    exp = int(time.time()) + SESSION_TTL_SEC
    conn = get_db_connection()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute("INSERT INTO os_sessions (session_id, username, csrf, exp) VALUES (%s, %s, %s, %s)",
                        (session_id, user, csrf, exp))
            conn.commit()
            cur.close()
        finally:
            conn.close()
    return session_id, csrf

def _validate_session(handler):
    session_id = _get_cookie(handler, 'session')
    sig = _get_cookie(handler, 'session_sig')
    if not session_id or not sig:
        return None

    expected = _sign_session_id(session_id)
    if not hmac.compare_digest(expected, sig):
        return None

    conn = get_db_connection()
    sess = None
    if conn:
        try:
            cur = conn.cursor()
            cur.execute("SELECT username, csrf, exp FROM os_sessions WHERE session_id = %s", (session_id,))
            res = cur.fetchone()
            if res:
                sess = {'user': res[0], 'csrf': res[1], 'exp': res[2]}
            cur.close()
        finally:
            conn.close()

    if not sess:
        return None
    if int(time.time()) > sess.get('exp', 0):
        # Delete expired session
        conn = get_db_connection()
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("DELETE FROM os_sessions WHERE session_id = %s", (session_id,))
                conn.commit()
                cur.close()
            finally:
                conn.close()
        return None
    return session_id, sess

def _validate_csrf(handler, sess):
    token = handler.headers.get('X-CSRF-Token', '')
    if not token or token != sess.get('csrf'):
        return False
    return True

def _rate_limited(handler):
    ip = handler.client_address[0] if handler.client_address else 'unknown'
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW_SEC

    times = RATE.get(ip, [])
    times = [t for t in times if t >= window_start]
    if len(times) >= RATE_LIMIT_MAX:
        RATE[ip] = times
        return True

    times.append(now)
    RATE[ip] = times
    return False

def _truncate_output(text: str, max_bytes: int):
    if text is None:
        text = ''
    b = text.encode('utf-8', errors='ignore')
    if len(b) <= max_bytes:
        return text, False
    # Truncate on character boundary
    truncated = b[:max_bytes].decode('utf-8', errors='ignore')
    return truncated, True

def _run_wsl_ubuntu_root(argv, timeout_sec: int):
    # argv is a command array passed to bash -lc? We avoid bash -c; run via exec directly.
    # For apt/chmod/stat/ls/cat/ps/kill we can run directly in bash -lc is not needed.
    result = subprocess.run(
        ['wsl', '-d', 'Ubuntu-24.04', '-u', 'root', '--cd', '~'] + argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout_sec
    )
    return result

def _deny_if_disallowed(command_text: str) -> bool:
    # For backwards-compatibility only; structured endpoint should be used.
    # Deny common shell metacharacters and dangerous tokens.
    disallowed_tokens = [
        'rm -rf /', 'rm -rf', 'shutdown', 'reboot', 'poweroff', 'halt',
        'useradd', 'adduser', 'mkfs', ':(){', 'chown -R', 'chmod -R',
        'sudo', 'dd ', 'curl ', 'wget ', 'nc ', 'netcat ', 'mkfs.', 'mount ', 'umount '
    ]
    metachars = ['&&', '||', ';', '|', '`', '$(', '>', '<', '&']
    if any(t in command_text for t in disallowed_tokens):
        return True
    if any(m in command_text for m in metachars):
        return True
    return False

# Allowlist execution: client sends {op, args}. We map to exact argv.
def execute_allowed(op: str, args: dict):
    # Hard timeout caps per op (increased to allow WSL cold boot)
    if op == 'ps_aux':
        argv = ['bash', '-lc', 'COLUMNS=80 LINES=24 ps aux']
        timeout_sec = 15
    elif op == 'whoami':
        argv = ['whoami']
        timeout_sec = 10
    elif op == 'pwd':
        argv = ['pwd']
        timeout_sec = 10
    elif op == 'ls':
        # args: {path}
        path = args.get('path', '/root')
        argv = ['ls', '-ap', '--group-directories-first', path]
        timeout_sec = 20
    elif op == 'cat':
        path = args.get('path')
        if not path:
            raise ValueError('Missing path')
        argv = ['cat', path]
        timeout_sec = 20
    elif op == 'write_file_base64':
        # args: {path, b64}
        path = args.get('path')
        b64 = args.get('b64', '')
        if not path:
            raise ValueError('Missing path')
        if not b64:
            raise ValueError('Missing b64')
        # Use bash -lc is avoided; use sh? We'll decode using python? Not available here.
        # So we allow a safe bash -c? Instead use: bash -lc 'base64 -d ...' - still shell.
        # Minimal safe approach: keep bash -c but only for this controlled decode pipeline.
        # Command string is constructed without user shell metacharacters.
        safe_path = path.replace('"', '').replace("'", '')
        argv = ['bash', '-lc', f'base64 -d <<< "{b64}" > "{safe_path}"']
        timeout_sec = 20
    elif op == 'stat':
        path = args.get('path')
        if not path:
            raise ValueError('Missing path')
        fmt = ' %A %a %U %G %s'
        argv = ['stat', '-c', fmt.strip(), path]
        timeout_sec = 20
    elif op == 'chmod':
        mode = args.get('mode')
        path = args.get('path')
        if not (isinstance(mode, str) and mode.isdigit() and len(mode) == 3):
            raise ValueError('Invalid mode')
        if not path:
            raise ValueError('Missing path')
        argv = ['chmod', mode, path]
        timeout_sec = 20
    elif op == 'kill':
        pid = args.get('pid')
        if not str(pid).isdigit():
            raise ValueError('Invalid pid')
        argv = ['kill', '-9', str(pid)]
        timeout_sec = 15
    elif op == 'touch':
        path = args.get('path')
        if not path:
            raise ValueError('Missing path')
        argv = ['touch', path]
        timeout_sec = 15
    elif op == 'mkdir_p':
        path = args.get('path')
        if not path:
            raise ValueError('Missing path')
        argv = ['mkdir', '-p', path]
        timeout_sec = 15
    elif op == 'rm_file':
        path = args.get('path')
        is_dir = bool(args.get('is_dir', False))
        if not path:
            raise ValueError('Missing path')
        argv = ['rm', '-f' if not is_dir else '-rf', path]
        timeout_sec = 25
    elif op == 'apt_cache_search':
        query = args.get('query', '')
        # Allow limited charset to avoid injections.
        if not query or len(query) > 80 or any(c in query for c in [';', '&', '|', '`', '$', '\n', '\r']):
            raise ValueError('Invalid query')
        argv = ['bash', '-lc', f'apt-cache search "{query}" | head -n 30']
        timeout_sec = 50
    elif op == 'apt_get_install':
        pkg = args.get('pkg', '')
        if not pkg or len(pkg) > 120:
            raise ValueError('Invalid pkg')
        if any(c in pkg for c in [';', '&', '|', '`', '$', '\n', '\r']):
            raise ValueError('Invalid pkg')
        argv = ['bash', '-lc', f'DEBIAN_FRONTEND=noninteractive apt-get install -y "{pkg}"']
        timeout_sec = 240
    elif op == 'net_tool':
        # args: {tool, host}
        tool = args.get('tool')
        host = args.get('host', '')
        if not host or len(host) > 200:
            raise ValueError('Invalid host')
        if any(c in host for c in [';', '&', '|', '`', '$', '\n', '\r']):
            raise ValueError('Invalid host')
        if tool == 'ping':
            argv = ['bash', '-lc', f'ping -c 4 "{host}"']
            timeout_sec = 30
        elif tool == 'nslookup':
            argv = ['bash', '-lc', f'nslookup "{host}"']
            timeout_sec = 30
        elif tool == 'nmap':
            argv = ['bash', '-lc', f'nmap -F "{host}"']
            timeout_sec = 150
        else:
            raise ValueError('Invalid tool')
    elif op == 'stats_sh':
        # Fixed script path from existing client usage
        argv = ['bash', '-lc', 'bash /mnt/d/ubuntu-web-os/stats.sh']
        timeout_sec = 30
    elif op == 'run_raw':
        command = args.get('command')
        if not command:
            raise ValueError('Missing command')
        command = f"export DEBIAN_FRONTEND=noninteractive; {command}"
        argv = ['bash', '-c', command]
        timeout_sec = 30
    elif op == 'mv':
        src = args.get('src')
        dest = args.get('dest')
        if not src or not dest:
            raise ValueError('Missing src or dest')
        argv = ['mv', src, dest]
        timeout_sec = 15
    elif op == 'compress':
        path = args.get('path')
        if not path:
            raise ValueError('Missing path')
        import os
        parent_dir = os.path.dirname(path)
        base_name = os.path.basename(path)
        archive_name = path + '.tar.gz'
        argv = ['tar', '-czf', archive_name, '-C', parent_dir, base_name]
        timeout_sec = 30
    elif op == 'apt_cache_show':
        pkg = args.get('pkg')
        if not pkg or len(pkg) > 120 or any(c in pkg for c in [';', '&', '|', '`', '$', '\n', '\r']):
            raise ValueError('Invalid pkg')
        argv = ['bash', '-lc', f'apt-cache show "{pkg}"']
        timeout_sec = 15
    elif op == 'apt_get_remove':
        pkg = args.get('pkg')
        if not pkg or len(pkg) > 120 or any(c in pkg for c in [';', '&', '|', '`', '$', '\n', '\r']):
            raise ValueError('Invalid pkg')
        argv = ['bash', '-lc', f'DEBIAN_FRONTEND=noninteractive apt-get remove -y "{pkg}"']
        timeout_sec = 180
    elif op == 'dpkg_query_status':
        pkg = args.get('pkg')
        if not pkg or len(pkg) > 120 or any(c in pkg for c in [';', '&', '|', '`', '$', '\n', '\r']):
            raise ValueError('Invalid pkg')
        argv = ['dpkg-query', '-W', pkg]
        timeout_sec = 10
    elif op == 'apt_get_install_simulate':
        pkg = args.get('pkg')
        if not pkg or len(pkg) > 120 or any(c in pkg for c in [';', '&', '|', '`', '$', '\n', '\r']):
            raise ValueError('Invalid pkg')
        argv = ['bash', '-lc', f'apt-get install -s "{pkg}"']
        timeout_sec = 20
    elif op == 'apt_get_update':
        argv = ['bash', '-lc', 'DEBIAN_FRONTEND=noninteractive apt-get update']
        timeout_sec = 180
    elif op == 'system_cleanup':
        clean_tmp = bool(args.get('clean_tmp', True))
        clean_apt = bool(args.get('clean_apt', True))
        clean_autoremove = bool(args.get('clean_autoremove', True))
        clean_logs = bool(args.get('clean_logs', True))
        
        stdout_parts = []
        stderr_parts = []
        exit_code = 0
        
        if clean_apt:
            res = _run_wsl_ubuntu_root(['apt-get', 'clean'], timeout_sec=60)
            if res.stdout: stdout_parts.append(res.stdout)
            if res.stderr: stderr_parts.append(res.stderr)
            if res.returncode != 0:
                exit_code = res.returncode
                
        if clean_autoremove:
            res = _run_wsl_ubuntu_root(['bash', '-lc', 'DEBIAN_FRONTEND=noninteractive apt-get autoremove -y'], timeout_sec=120)
            if res.stdout: stdout_parts.append(res.stdout)
            if res.stderr: stderr_parts.append(res.stderr)
            if res.returncode != 0:
                exit_code = res.returncode
                
        if clean_tmp:
            res = _run_wsl_ubuntu_root(['bash', '-c', 'find /tmp -mindepth 1 -maxdepth 2 -delete 2>/dev/null || true'], timeout_sec=30)
            if res.stdout: stdout_parts.append(res.stdout)
            
        if clean_logs:
            res = _run_wsl_ubuntu_root(['journalctl', '--vacuum-size=50M'], timeout_sec=60)
            if res.stdout: stdout_parts.append(res.stdout)
            if res.stderr: stderr_parts.append(res.stderr)
            if res.returncode != 0:
                exit_code = res.returncode
                
        combined_stdout = '\n'.join(stdout_parts)
        combined_stderr = '\n'.join(stderr_parts)
        
        stdout, stdout_trunc = _truncate_output(combined_stdout, MAX_STDOUT_BYTES)
        stderr, stderr_trunc = _truncate_output(combined_stderr, MAX_STDERR_BYTES)
        
        return {
            'stdout': stdout,
            'stderr': stderr,
            'exit_code': exit_code,
            'truncated_stdout': stdout_trunc,
            'truncated_stderr': stderr_trunc
        }
    else:
        raise ValueError('Unsupported Operation!#!')

    result = _run_wsl_ubuntu_root(argv, timeout_sec=timeout_sec)
    stdout, stdout_trunc = _truncate_output(result.stdout, MAX_STDOUT_BYTES)
    stderr, stderr_trunc = _truncate_output(result.stderr, MAX_STDERR_BYTES)

    return {
        'stdout': stdout,
        'stderr': stderr,
        'exit_code': result.returncode,
        'truncated_stdout': stdout_trunc,
        'truncated_stderr': stderr_trunc
    }



class UbuntuOSHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Prefer static ALLOWED_ORIGIN if set; otherwise echo back the request Origin.
        static_origin = ALLOWED_ORIGIN.strip()
        request_origin = self.headers.get('Origin', '') if hasattr(self, 'headers') and self.headers else ''
        origin = static_origin if static_origin else request_origin
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Credentials', 'true')
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token')
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        
        # Database endpoints
        if parsed.path == '/api/db/notes':
            try:
                conn = get_db_connection()
                if conn:
                    try:
                        cur = conn.cursor()
                        cur.execute("SELECT content FROM os_notes ORDER BY id DESC LIMIT 1")
                        res = cur.fetchone()
                        content = res[0] if res else ''
                        cur.close()
                        _json_response(self, 200, {'content': content})
                        return
                    finally:
                        conn.close()
                _json_response(self, 500, {'error': 'Database connection failed'})
                return
            except Exception as e:
                import traceback
                traceback.print_exc()
                _json_response(self, 500, {'error': str(e)})
                return

        if parsed.path == '/api/db/settings':
            try:
                conn = get_db_connection()
                if conn:
                    try:
                        cur = conn.cursor()
                        cur.execute("SELECT settings FROM os_settings ORDER BY id DESC LIMIT 1")
                        res = cur.fetchone()
                        settings = res[0] if res else {}
                        cur.close()
                        _json_response(self, 200, {'settings': settings})
                        return
                    finally:
                        conn.close()
                _json_response(self, 500, {'error': 'Database connection failed'})
                return
            except Exception as e:
                import traceback
                traceback.print_exc()
                _json_response(self, 500, {'error': str(e)})
                return
        
        # Check if it targets the path-based proxy directly
        if parsed.path.startswith('/proxy/https/') or parsed.path.startswith('/proxy/http/'):
            is_https = parsed.path.startswith('/proxy/https/')
            prefix_len = len('/proxy/https/') if is_https else len('/proxy/http/')
            scheme = 'https://' if is_https else 'http://'
            target_url = scheme + parsed.path[prefix_len:]
            if parsed.query:
                target_url += '?' + parsed.query
            handle_proxy_request(self, target_url, method='GET')
            return
            
        # Check if it targets the query-based proxy directly
        if parsed.path == '/api/proxy':
            from urllib.parse import parse_qs
            query = parse_qs(parsed.query)
            target_url = query.get('url', [''])[0]
            if not target_url:
                _json_response(self, 400, {'error': 'Missing url parameter'})
                return
            handle_proxy_request(self, target_url, method='GET')
            return

        # Check if the requested path is a local file, directory, or local API endpoint
        local_path = self.translate_path(parsed.path)
        is_local = os.path.exists(local_path)
        is_local_api = parsed.path in ('/api/login', '/api/get_profile', '/api/profile', '/api/logout', '/api/command')
        
        referer = self.headers.get('Referer', '')
        
        # If it's not local, but the request was initiated by a page loaded via proxy, proxy it.
        if not is_local_api and not is_local and referer:
            ref_target = ''
            if '/api/proxy?url=' in referer:
                from urllib.parse import parse_qs, urlparse as parse_url
                ref_parsed = parse_url(referer)
                ref_query = parse_qs(ref_parsed.query)
                ref_target = ref_query.get('url', [''])[0]
            elif '/proxy/https/' in referer:
                from urllib.parse import urlparse as parse_url
                ref_parsed = parse_url(referer)
                path = ref_parsed.path
                idx = path.find('/proxy/https/')
                if idx != -1:
                    ref_target = 'https://' + path[idx + len('/proxy/https/'):]
            elif '/proxy/http/' in referer:
                from urllib.parse import urlparse as parse_url
                ref_parsed = parse_url(referer)
                path = ref_parsed.path
                idx = path.find('/proxy/http/')
                if idx != -1:
                    ref_target = 'http://' + path[idx + len('/proxy/http/'):]
                    
            if ref_target:
                from urllib.parse import urljoin
                target_url = urljoin(ref_target, self.path)
                handle_proxy_request(self, target_url, method='GET')
                return

        super().do_GET()

    def do_OPTIONS(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/proxy/https/') or parsed.path.startswith('/proxy/http/'):
            is_https = parsed.path.startswith('/proxy/https/')
            prefix_len = len('/proxy/https/') if is_https else len('/proxy/http/')
            scheme = 'https://' if is_https else 'http://'
            target_url = scheme + parsed.path[prefix_len:]
            if parsed.query:
                target_url += '?' + parsed.query
            handle_proxy_request(self, target_url, method='OPTIONS')
            return
            
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        
        # Proxy POST requests
        if parsed.path.startswith('/proxy/https/') or parsed.path.startswith('/proxy/http/'):
            is_https = parsed.path.startswith('/proxy/https/')
            prefix_len = len('/proxy/https/') if is_https else len('/proxy/http/')
            scheme = 'https://' if is_https else 'http://'
            target_url = scheme + parsed.path[prefix_len:]
            if parsed.query:
                target_url += '?' + parsed.query
            handle_proxy_request(self, target_url, method='POST')
            return
            
        global SESSION_USER, SESSION_PASS
        
        # Database endpoints
        if self.path == '/api/db/notes':
            data = _read_limited_json(self)
            if not data or data.get('__error__'):
                _json_response(self, 400, {'error': 'Invalid payload'})
                return
            content = data.get('content', '')
            conn = get_db_connection()
            if conn:
                try:
                    cur = conn.cursor()
                    cur.execute("INSERT INTO os_notes (content) VALUES (%s)", (content,))
                    conn.commit()
                    cur.close()
                    _json_response(self, 200, {'success': True})
                    return
                finally:
                    conn.close()
            _json_response(self, 500, {'error': 'Database connection failed'})
            return

        if self.path == '/api/db/settings':
            data = _read_limited_json(self)
            if not data or data.get('__error__'):
                _json_response(self, 400, {'error': 'Invalid payload'})
                return
            
            import json as json_mod
            settings_str = json_mod.dumps(data.get('settings', {}))
            conn = get_db_connection()
            if conn:
                try:
                    cur = conn.cursor()
                    cur.execute("INSERT INTO os_settings (settings) VALUES (%s::jsonb)", (settings_str,))
                    conn.commit()
                    cur.close()
                    _json_response(self, 200, {'success': True})
                    return
                finally:
                    conn.close()
            _json_response(self, 500, {'error': 'Database connection failed'})
            return
            
        # Auth/login endpoints
        if self.path == '/api/login':
            data = _read_limited_json(self)
            if not data or data.get('__error__'):
                _json_response(self, 400, {'error': data.get('__error__', 'Invalid payload') if isinstance(data, dict) else 'Invalid payload'})
                return
            username = str(data.get('username', ''))
            password = str(data.get('password', ''))
            is_valid_default = (username == 'kali' and password == 'kali') or (username == 'admin' and password == 'admin')
            is_valid_env = (username == SESSION_USER and password == SESSION_PASS)
            if not (is_valid_env or is_valid_default):
                _json_response(self, 401, {'error': 'Invalid credentials'})
                return

            session_id, csrf = _new_session(username)
            # Cookies are split for simple signing.
            session_sig = _sign_session_id(session_id)

            # Detect if request came over HTTPS (e.g. via ngrok) so we can set Secure flag
            forwarded_proto = self.headers.get('X-Forwarded-Proto', '')
            is_secure = forwarded_proto.lower() == 'https'
            request_origin = self.headers.get('Origin', '')
            is_cross_origin = bool(request_origin) and 'localhost' not in request_origin
            if is_cross_origin or is_secure:
                # Cross-origin (ngrok, etc.): SameSite=None requires Secure
                cookie_attrs = f'HttpOnly; SameSite=None; Secure; Path=/; Max-Age={SESSION_TTL_SEC}'
            else:
                cookie_attrs = f'HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_TTL_SEC}'
            body = json.dumps({'csrf': csrf}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Set-Cookie', f'session={session_id}; {cookie_attrs}')
            self.send_header('Set-Cookie', f'session_sig={session_sig}; {cookie_attrs}')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # Get Profile
        if self.path == '/api/get_profile':
            vs = _validate_session(self)
            if not vs:
                _json_response(self, 401, {'error': 'Not authenticated'})
                return
            _json_response(self, 200, {'username': SESSION_USER})
            return

        # Update Profile (Credentials)
        if self.path == '/api/profile':
            vs = _validate_session(self)
            if not vs:
                _json_response(self, 401, {'error': 'Not authenticated'})
                return
            session_id, sess = vs
            if not _validate_csrf(self, sess):
                _json_response(self, 403, {'error': 'Invalid CSRF token'})
                return
            
            data = _read_limited_json(self)
            if not data or data.get('__error__'):
                _json_response(self, 400, {'error': data.get('__error__', 'Invalid payload')})
                return
            
            new_user = str(data.get('username', '')).strip()
            new_pass = str(data.get('password', '')).strip()
            
            if not new_user or not new_pass:
                _json_response(self, 400, {'error': 'Username and password cannot be empty'})
                return
            
            SESSION_USER = new_user
            SESSION_PASS = new_pass
            
            # Persist to .env if possible
            try:
                env_path = os.path.join(os.path.dirname(__file__), '.env')
                lines = []
                if os.path.exists(env_path):
                    with open(env_path, 'r') as f:
                        lines = f.readlines()
                
                user_set = False
                pass_set = False
                for i, line in enumerate(lines):
                    if line.startswith('OS_WEBOS_USER='):
                        lines[i] = f'OS_WEBOS_USER={new_user}\n'
                        user_set = True
                    elif line.startswith('OS_WEBOS_PASS='):
                        lines[i] = f'OS_WEBOS_PASS={new_pass}\n'
                        pass_set = True
                
                if not user_set:
                    lines.append(f'OS_WEBOS_USER={new_user}\n')
                if not pass_set:
                    lines.append(f'OS_WEBOS_PASS={new_pass}\n')
                
                with open(env_path, 'w') as f:
                    f.writelines(lines)
            except Exception as e:
                pass
                
            _json_response(self, 200, {'ok': True, 'username': SESSION_USER})
            return

        # Logout
        if self.path == '/api/logout':
            vs = _validate_session(self)
            if vs:
                session_id, _sess = vs
                conn = get_db_connection()
                if conn:
                    try:
                        cur = conn.cursor()
                        cur.execute("DELETE FROM os_sessions WHERE session_id = %s", (session_id,))
                        conn.commit()
                        cur.close()
                    finally:
                        conn.close()
            self.send_response(200)
            self.send_header('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
            self.send_header('Set-Cookie', 'session_sig=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
            self.end_headers()
            _json_response(self, 200, {'ok': True})
            return

        # Only allow execution endpoints when authenticated
        vs = _validate_session(self)
        if not vs:
            # Avoid CSRF checks when unauthenticated
            _json_response(self, 401, {'error': 'Not authenticated'})
            return

        # Enforce CSRF for any state/action endpoint
        _session_ok = vs[0]
        _csrf_ok = _validate_csrf(self, vs[1])
        if not _csrf_ok:
            _json_response(self, 403, {'error': 'Invalid CSRF token'})
            return

        # New structured command endpoint (preferred)
        if self.path == '/api/command':
            data = _read_limited_json(self)
            if not data or data.get('__error__'):
                _json_response(self, 400, {'error': data.get('__error__', 'Invalid payload') if isinstance(data, dict) else 'Invalid payload'})
                return

            # Rate limit
            if _rate_limited(self):
                _json_response(self, 429, {'error': 'Rate limit exceeded'})
                return

            op = data.get('op', '')
            args = data.get('args', {})
            if not isinstance(op, str) or not op:
                _json_response(self, 400, {'error': 'Missing op'})
                return
            if not isinstance(args, dict):
                _json_response(self, 400, {'error': 'Invalid args'})
                return
            
            ### aws api
            if op.startswith('aws_'):
                try:
                    from aws.handler import handle_aws_api
                    response = handle_aws_api(op, args)
                    _json_response(self, 200, response)
                except Exception as e:
                    _json_response(self, 500, {'error': f'AWS Module Error: {str(e)}'})
                return

            ### liae api — Live Infrastructure Autopsy Engine
            if op.startswith('liae_'):
                try:
                    from liae.handler import handle_liae_api
                    response = handle_liae_api(op, args)
                    _json_response(self, 200, response)
                except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                    # Client closed the connection before we could reply — nothing to do
                    pass
                except Exception as e:
                    import traceback; traceback.print_exc()
                    try:
                        _json_response(self, 500, {'error': f'LIAE Module Error: {str(e)}'})
                    except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                        pass  # Client already gone
                return

            try:
                response = execute_allowed(op, args)
                # Add truncated indicators (already present)
                _json_response(self, 200, response)
            except ValueError as e:
                _json_response(self, 400, {'error': str(e)})
            except subprocess.TimeoutExpired:
                _json_response(self, 408, {'stdout': '', 'stderr': 'Error: command timed out', 'exit_code': -1})
            except Exception as e:
                _json_response(self, 500, {'stdout': '', 'stderr': f'Error: {str(e)}', 'exit_code': -2})
            return

        # Command Stream endpoint
        if self.path == '/api/command_stream':
            data = _read_limited_json(self)
            if not data or data.get('__error__'):
                _json_response(self, 400, {'error': data.get('__error__', 'Invalid payload') if isinstance(data, dict) else 'Invalid payload'})
                return

            # Rate limit
            if _rate_limited(self):
                _json_response(self, 429, {'error': 'Rate limit exceeded'})
                return

            op = data.get('op', '')
            args = data.get('args', {})
            if op != 'run_raw':
                _json_response(self, 400, {'error': 'Only run_raw supported for streaming'})
                return

            command = args.get('command')
            if not command:
                _json_response(self, 400, {'error': 'Missing command'})
                return

            command = f"export DEBIAN_FRONTEND=noninteractive; {command}"
            argv = ['bash', '-c', command]

            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()

            proc = None
            try:
                proc = subprocess.Popen(
                    ['wsl', '-d', 'Ubuntu-24.04', '-u', 'root', '--cd', '~'] + argv,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1 # Line buffered
                )
                for line in iter(proc.stdout.readline, ''):
                    self.wfile.write(line.encode('utf-8'))
                    self.wfile.flush()
            except Exception as e:
                if proc and proc.poll() is None:
                    try:
                        proc.terminate()
                        proc.wait(timeout=2)
                    except:
                        try:
                            proc.kill()
                        except:
                            pass
            finally:
                if proc:
                    try:
                        proc.stdout.close()
                    except:
                        pass
                    try:
                        proc.wait()
                    except:
                        pass
            return

        # Legacy endpoint disabled for security
        if self.path == '/api/execute':
            _json_response(self, 410, {'error': 'Legacy execute endpoint disabled. Use /api/command'})
            return

        super().do_POST()


if __name__ == '__main__':
    port = 9500
    server_address = ('', port)
    httpd = ThreadingHTTPServer(server_address, UbuntuOSHandler)
    print(f"Starting server on port {port}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()
