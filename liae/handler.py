"""
LIAE — Live Infrastructure Autopsy Engine
Backend: snapshot collector + timeline API handler
Runs as a background thread, collecting system state every second.
"""

import threading
import time
import json
import subprocess
import os
from collections import deque
from datetime import datetime

# ── Configuration ─────────────────────────────────────────────
MAX_SNAPSHOTS = 1800  # 30 minutes at 1/s, ~15-25MB RAM max
COLLECT_INTERVAL = 1.5  # seconds between snapshots

# ── Shared state ──────────────────────────────────────────────
_snapshot_buffer = deque(maxlen=MAX_SNAPSHOTS)
_snapshot_lock = threading.Lock()
_collector_running = False
_collector_thread = None


# ── Snapshot collection ───────────────────────────────────────

def _run_local(argv, timeout=3):
    """Run a command on the host Windows system (not WSL) for local metrics."""
    try:
        result = subprocess.run(
            argv,
            capture_output=True, text=True, timeout=timeout,
            creationflags=0x08000000 if os.name == 'nt' else 0  # CREATE_NO_WINDOW on Windows
        )
        return result.stdout.strip(), result.stderr.strip(), result.returncode
    except Exception as e:
        return '', str(e), -1


def _run_wsl(argv, timeout=4):
    """Run a command inside WSL Ubuntu."""
    try:
        result = subprocess.run(
            ['wsl', '-d', 'Ubuntu-24.04', '-u', 'root', '--cd', '~'] + argv,
            capture_output=True, text=True, timeout=timeout,
            creationflags=0x08000000 if os.name == 'nt' else 0
        )
        return result.stdout.strip(), result.stderr.strip(), result.returncode
    except Exception:
        return '', '', -1


def _collect_processes_wsl():
    """Get top processes from WSL."""
    stdout, _, rc = _run_wsl(
        ['ps', 'aux', '--no-headers', '--sort=-%cpu'],
        timeout=4
    )
    procs = []
    if rc != 0 or not stdout:
        return procs
    for line in stdout.split('\n')[:25]:
        parts = line.split(None, 10)
        if len(parts) >= 11:
            try:
                procs.append({
                    'user': parts[0],
                    'pid': parts[1],
                    'cpu': float(parts[2]),
                    'mem': float(parts[3]),
                    'cmd': parts[10][:80].strip(),
                })
            except (ValueError, IndexError):
                continue
    return procs


def _collect_memory_wsl():
    """Read /proc/meminfo from WSL."""
    stdout, _, rc = _run_wsl(['cat', '/proc/meminfo'], timeout=3)
    mem = {}
    if rc != 0:
        return mem
    for line in stdout.split('\n'):
        for key in ('MemTotal', 'MemFree', 'MemAvailable', 'Buffers', 'Cached'):
            if line.startswith(key + ':'):
                try:
                    mem[key] = int(line.split()[1])
                except (ValueError, IndexError):
                    pass
    return mem


def _collect_network_wsl():
    """Get network connection stats from WSL."""
    net = {'established': 0, 'summary': ''}
    stdout, _, rc = _run_wsl(['ss', '-s'], timeout=3)
    if rc == 0:
        net['summary'] = stdout[:300]
    stdout2, _, rc2 = _run_wsl(['ss', '-tn', 'state', 'established'], timeout=3)
    if rc2 == 0:
        lines = [l for l in stdout2.split('\n') if l.strip()]
        net['established'] = max(0, len(lines) - 1)
    return net


def _collect_containers_wsl():
    """Get Docker container status from WSL."""
    containers = []
    stdout, _, rc = _run_wsl(
        ['docker', 'ps', '--format', '{{.Names}}|||{{.Status}}|||{{.Image}}'],
        timeout=4
    )
    if rc != 0 or not stdout:
        return containers
    for line in stdout.split('\n'):
        parts = line.split('|||')
        if len(parts) >= 3:
            containers.append({
                'name': parts[0].strip(),
                'status': parts[1].strip(),
                'image': parts[2].strip(),
            })
    return containers


def _collect_disk_wsl():
    """Get disk usage from WSL."""
    stdout, _, rc = _run_wsl(['df', '-h', '/'], timeout=3)
    if rc != 0:
        return {}
    lines = stdout.split('\n')
    if len(lines) >= 2:
        parts = lines[1].split()
        if len(parts) >= 5:
            return {
                'filesystem': parts[0],
                'total': parts[1],
                'used': parts[2],
                'free': parts[3],
                'pct': parts[4],
            }
    return {}


def _collect_auth_events_wsl():
    """Get recent auth log events from WSL."""
    events = []
    stdout, _, rc = _run_wsl(['tail', '-n', '10', '/var/log/auth.log'], timeout=3)
    if rc == 0 and stdout:
        for line in stdout.split('\n')[-5:]:
            if line.strip():
                events.append(line.strip()[:120])
    return events


def _detect_anomalies(snap):
    """Analyze snapshot data and emit anomaly events."""
    anomalies = []

    # High CPU processes
    for proc in snap.get('processes', []):
        if proc.get('cpu', 0) > 80:
            anomalies.append({
                'type': 'cpu_spike',
                'severity': 'critical',
                'msg': f"CPU spike {proc['cpu']:.0f}%: {proc['cmd'][:50]}",
            })
        elif proc.get('cpu', 0) > 50:
            anomalies.append({
                'type': 'cpu_spike',
                'severity': 'warning',
                'msg': f"High CPU {proc['cpu']:.0f}%: {proc['cmd'][:50]}",
            })

    # Low memory
    mem = snap.get('memory', {})
    if mem.get('MemTotal') and mem.get('MemAvailable'):
        avail_mb = mem['MemAvailable'] // 1024
        total_mb = mem['MemTotal'] // 1024
        pct_used = 100 * (1 - mem['MemAvailable'] / mem['MemTotal'])
        if avail_mb < 100:
            anomalies.append({
                'type': 'low_memory',
                'severity': 'critical',
                'msg': f"Critical low memory: only {avail_mb}MB free ({pct_used:.0f}% used)",
            })
        elif pct_used > 85:
            anomalies.append({
                'type': 'low_memory',
                'severity': 'warning',
                'msg': f"High memory usage: {pct_used:.0f}% ({avail_mb}MB free)",
            })

    # Unhealthy containers
    for c in snap.get('containers', []):
        status = c.get('status', '').lower()
        if status and 'up' not in status and 'running' not in status:
            anomalies.append({
                'type': 'container_degraded',
                'severity': 'warning',
                'msg': f"Container '{c['name']}' status: {c['status']}",
            })

    # High network connections
    net_conn = snap.get('network', {}).get('established', 0)
    if net_conn > 1000:
        anomalies.append({
            'type': 'high_connections',
            'severity': 'warning',
            'msg': f"High active TCP connections: {net_conn}",
        })

    return anomalies


def collect_one_snapshot():
    """Collect a full system snapshot. Returns dict."""
    ts = time.time()
    ts_str = datetime.fromtimestamp(ts).strftime('%H:%M:%S')

    snap = {
        'ts': ts,
        'ts_str': ts_str,
        'processes': [],
        'memory': {},
        'disk': {},
        'network': {},
        'containers': [],
        'auth_events': [],
        'anomalies': [],
    }

    # Collect all layers (run in parallel for speed)
    threads = []
    results = {}

    def _collect(key, fn):
        try:
            results[key] = fn()
        except Exception as e:
            results[key] = None

    for key, fn in [
        ('processes', _collect_processes_wsl),
        ('memory', _collect_memory_wsl),
        ('network', _collect_network_wsl),
        ('containers', _collect_containers_wsl),
        ('disk', _collect_disk_wsl),
        ('auth', _collect_auth_events_wsl),
    ]:
        t = threading.Thread(target=_collect, args=(key, fn), daemon=True)
        t.start()
        threads.append(t)

    # Wait up to 5 seconds for all collectors
    for t in threads:
        t.join(timeout=5)

    snap['processes'] = results.get('processes') or []
    snap['memory'] = results.get('memory') or {}
    snap['network'] = results.get('network') or {}
    snap['containers'] = results.get('containers') or []
    snap['disk'] = results.get('disk') or {}
    snap['auth_events'] = results.get('auth') or []
    snap['anomalies'] = _detect_anomalies(snap)

    return snap


def _collector_loop():
    global _collector_running
    while _collector_running:
        try:
            snap = collect_one_snapshot()
            with _snapshot_lock:
                _snapshot_buffer.append(snap)
        except Exception as e:
            pass  # Never crash the collector thread
        time.sleep(COLLECT_INTERVAL)


def start_collector():
    global _collector_running, _collector_thread
    if not _collector_running:
        _collector_running = True
        _collector_thread = threading.Thread(
            target=_collector_loop,
            name='liae-collector',
            daemon=True
        )
        _collector_thread.start()
        return True
    return False


def stop_collector():
    global _collector_running
    _collector_running = False


# ── API handler ───────────────────────────────────────────────

def handle_liae_api(op, params):
    """Main dispatch for all liae_* operations."""

    if op == 'liae_start':
        started = start_collector()
        with _snapshot_lock:
            count = len(_snapshot_buffer)
        return {
            'success': True,
            'already_running': not started,
            'snapshot_count': count,
        }

    elif op == 'liae_stop':
        stop_collector()
        return {'success': True}

    elif op == 'liae_status':
        with _snapshot_lock:
            count = len(_snapshot_buffer)
            first_ts = _snapshot_buffer[0]['ts'] if _snapshot_buffer else None
            last_ts = _snapshot_buffer[-1]['ts'] if _snapshot_buffer else None
        duration = (last_ts - first_ts) if first_ts and last_ts else 0
        return {
            'running': _collector_running,
            'snapshot_count': count,
            'duration_seconds': round(duration, 1),
            'first_ts': first_ts,
            'last_ts': last_ts,
        }

    elif op == 'liae_timeline':
        # Return a compact, downsampled timeline index for canvas drawing.
        # Cap at MAX_POINTS to keep the JSON response well under 80KB.
        MAX_POINTS = 240
        with _snapshot_lock:
            snaps = list(_snapshot_buffer)

        total = len(snaps)
        if total == 0:
            return {'timeline': [], 'count': 0}

        # Downsample: pick evenly-spaced indices
        if total <= MAX_POINTS:
            selected = snaps
        else:
            step = total / MAX_POINTS
            selected = [snaps[int(i * step)] for i in range(MAX_POINTS)]

        timeline = []
        for s in selected:
            procs = s.get('processes', [])
            mem   = s.get('memory', {})
            # Use top-process CPU rather than average — more useful
            top_cpu = procs[0].get('cpu', 0) if procs else 0
            mem_pct = 0
            if mem.get('MemTotal') and mem.get('MemAvailable'):
                mem_pct = 100 * (1 - mem['MemAvailable'] / mem['MemTotal'])
            anomalies = s.get('anomalies', [])
            # Keep fields minimal — every byte counts at 240 points
            timeline.append({
                'ts':  round(s['ts'], 1),         # 12 chars
                'tss': s.get('ts_str', ''),        # 10 chars  (short key)
                'cpu': round(top_cpu, 1),          # 4 chars
                'mem': round(mem_pct, 1),          # 4 chars
                'net': s.get('network', {}).get('established', 0),  # 1-4 chars
                'ac':  len(anomalies),             # 1 char    (anomaly count)
                'hc':  1 if any(a.get('severity') == 'critical' for a in anomalies) else 0,  # 1 char
            })
        return {'timeline': timeline, 'count': total}

    elif op == 'liae_current':
        with _snapshot_lock:
            if not _snapshot_buffer:
                return {'error': 'No snapshots available. Is the collector running?'}
            snap = dict(_snapshot_buffer[-1])
        return _sanitize_snap(snap)

    elif op == 'liae_snapshot_at':
        ts = params.get('ts')
        if ts is None:
            return {'error': 'Missing ts parameter'}
        ts = float(ts)
        with _snapshot_lock:
            snaps = list(_snapshot_buffer)
        if not snaps:
            return {'error': 'No snapshots available'}
        closest = min(snaps, key=lambda s: abs(s['ts'] - ts))
        return _sanitize_snap(closest)

    elif op == 'liae_diff':
        ts1 = params.get('ts1')
        ts2 = params.get('ts2')
        if ts1 is None or ts2 is None:
            return {'error': 'Missing ts1 or ts2'}
        ts1, ts2 = float(ts1), float(ts2)

        with _snapshot_lock:
            snaps = list(_snapshot_buffer)

        if len(snaps) < 2:
            return {'error': 'Need at least 2 snapshots for a diff'}

        s1 = min(snaps, key=lambda s: abs(s['ts'] - ts1))
        s2 = min(snaps, key=lambda s: abs(s['ts'] - ts2))

        pids1 = {p['pid']: p for p in s1.get('processes', [])}
        pids2 = {p['pid']: p for p in s2.get('processes', [])}
        new_procs = [p for pid, p in pids2.items() if pid not in pids1]
        gone_procs = [p for pid, p in pids1.items() if pid not in pids2]

        mem1 = s1.get('memory', {})
        mem2 = s2.get('memory', {})
        avail_delta = (mem2.get('MemAvailable', 0) - mem1.get('MemAvailable', 0))

        return {
            't1': s1.get('ts_str', ''),
            't2': s2.get('ts_str', ''),
            'new_processes': new_procs[:20],
            'gone_processes': gone_procs[:20],
            'memory_delta': {
                'available_kb_change': avail_delta,
            },
            'network_delta': {
                'connection_change': (
                    s2.get('network', {}).get('established', 0) -
                    s1.get('network', {}).get('established', 0)
                ),
            },
            'new_containers': [
                c for c in s2.get('containers', [])
                if c['name'] not in [x['name'] for x in s1.get('containers', [])]
            ],
            'gone_containers': [
                c for c in s1.get('containers', [])
                if c['name'] not in [x['name'] for x in s2.get('containers', [])]
            ],
        }

    return {'error': f'Unknown LIAE operation: {op}'}


def _sanitize_snap(snap):
    """Return a clean copy of a snapshot, trimming large fields."""
    return {
        'ts': snap.get('ts'),
        'ts_str': snap.get('ts_str', ''),
        'processes': snap.get('processes', [])[:30],
        'memory': snap.get('memory', {}),
        'disk': snap.get('disk', {}),
        'network': {
            'established': snap.get('network', {}).get('established', 0),
            'summary': snap.get('network', {}).get('summary', '')[:300],
        },
        'containers': snap.get('containers', []),
        'auth_events': snap.get('auth_events', [])[:10],
        'anomalies': snap.get('anomalies', []),
    }
