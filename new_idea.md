# 🧬 Live Infrastructure Autopsy Engine (LIAE)

> **The world's first browser-based, real-time system failure forensics + time-travel debugger for live infrastructure.**

---

## 🔥 What is it?

A built-in **"black box recorder"** for your entire server — like an airplane's flight recorder, but for your OS, containers, databases, and cloud services.

It **continuously snapshots** the state of everything (processes, file changes, memory, network connections, container events, K8s pod statuses, AWS resource changes) and stores a **compressed circular timeline** — so when something breaks, you can **rewind time** and *see exactly what happened* in a visual timeline interface.

> Think: **Git blame, but for your entire live system — inspectable in a beautiful web UI.**

---

## 💡 Why This Has NEVER Been Built

| Existing Tool | What it misses |
|---|---|
| `dmesg`, `journalctl` | Text logs only, no cross-correlation, no UI |
| Datadog / New Relic | SaaS only, expensive, no local replay, no filesystem/process/container correlation |
| Linux `auditd` | Raw syscall dumps, impossible to visualize or correlate |
| `strace` / `bpftrace` | Per-process only, no system-wide timeline |
| AWS CloudTrail | Only cloud API events, not OS-level |
| GDB / core dumps | Post-mortem only, no live replay |
| **LIAE** | **All of the above, unified, visual, time-travel-capable, browser-native, self-hosted** |

**Nobody has ever built a unified, browser-native, time-travel-capable infrastructure forensics tool that works locally AND on cloud — inside a Web OS environment.**

---

## 🎯 Core Features

### 1. 🕐 The Timeline Scrubber
A horizontal timeline bar at the top — like a video player seek bar — showing the last **N minutes** of recorded system state.

- Drag to any point in time → the entire dashboard updates to show what the system looked like **at that exact moment**
- Color-coded events: 🔴 crashes, 🟡 spikes, 🟢 deployments, 🔵 logins, ⚪ normal

### 2. 🔍 Multi-Layer Event Correlation
At any point in time, LIAE shows:

```
TIME: 14:32:07.443
─────────────────────────────────────────────────────────
🖥️  PROCESS LAYER   │ nginx[1234] CPU spike 89% │ python[9021] OOM killed
🗂️  FILESYSTEM       │ /etc/nginx/nginx.conf MODIFIED │ /var/log +2.3MB
🐳  CONTAINERS       │ webos-app restarted (exitCode 137)
☸️  KUBERNETES        │ Pod webos-pod-7f4j EVICTED (OOM)
☁️  AWS EVENTS       │ RDS Failover triggered → us-east-1c promoted
🌐  NETWORK          │ 4,291 new connections │ 3 IPs rate-limited
🔑  AUTH             │ 2 sudo events │ SSH login from 192.168.1.10
─────────────────────────────────────────────────────────
ROOT CAUSE HYPOTHESIS: OOM → Container killed → K8s Eviction → DB Failover
```

### 3. 🤖 AI Root Cause Hypothesis Engine
The engine automatically:
1. Detects **causal chains** between events
2. Generates a **"probable root cause"** hypothesis card
3. Highlights the **first anomaly** in the chain (the "patient zero" event)
4. Shows you which config file, which process, which deploy triggered it

### 4. 🎬 "Incident Replay" Mode
Click a past incident → it plays back as an **animated sequence** showing:
- Which processes spawned/died
- How memory/CPU evolved
- Which files changed
- Network traffic flows as animated arrows
- AWS resource state transitions on the topology map

### 5. 📸 Snapshot Diffing
Compare **any two points in time** side by side:
- What processes existed at T1 vs T2
- What files changed between T1 and T2 (like `git diff` for your filesystem)
- What network connections opened/closed
- Container/K8s state diff

### 6. 🚨 Predictive Anomaly Detection
Based on the rolling baseline (last 24h of snapshots), LIAE learns "normal" and **alerts before failures**:
- "Memory usage growing 3x faster than baseline — OOM likely in ~4 minutes"
- "Disk I/O pattern matches pre-crash pattern from yesterday"
- "K8s pod restart count exceeding safe threshold"

### 7. 🔗 Cross-System Blast Radius Map
When a failure occurs, LIAE visualizes the **blast radius** — which other components were affected and how the failure propagated:

```
nginx crash
   └─► webos-app container restart
        └─► K8s pod eviction
             └─► Redis connection pool exhausted
                  └─► RDS connection spike → Failover
                       └─► Route53 DNS TTL delay (47s downtime)
```

### 8. 📤 One-Click Incident Report
Export a complete, beautifully formatted **PDF incident report** containing:
- Timeline of events
- Root cause hypothesis
- Blast radius map
- System state before/during/after
- Recommended fixes

---

## 🏗️ How to Implement It in This Web OS

### Backend (server.py additions)
```python
# Circular buffer: last 30 minutes of snapshots, 1 snapshot/second
# Each snapshot: ~5-15KB compressed (LZMA)
# Storage: ~30min × 60s × 10KB = ~18MB max

/api/liae/snapshot     # Returns current state snapshot
/api/liae/timeline     # Returns compressed timeline index
/api/liae/replay?t=X   # Returns state at timestamp X
/api/liae/diff?t1=X&t2=Y  # Returns diff between two states
/api/liae/anomalies    # Returns detected anomalies
```

### Frontend (new LIAE window)
- Timeline scrubber component (like a video player)
- Multi-layer event grid (the "layers panel")
- Causal chain graph (D3.js force layout)
- Animated replay engine
- Snapshot diff viewer

### Data Collected Per Snapshot
```python
snapshot = {
    "ts": timestamp,
    "processes": ps_output,          # from /proc
    "memory": meminfo,               # from /proc/meminfo
    "disk_io": diskstats,            # from /proc/diskstats
    "network": netstat_output,       # active connections
    "file_events": inotify_events,   # FS changes
    "containers": docker_ps,         # container states
    "k8s": kubectl_get_pods,         # pod states
    "aws_events": cloudtrail_tail,   # AWS API events
    "auth": auth_log_tail,           # auth events
}
```

---

## 🎨 UI Concept

```
┌─────────────────────────────────────────────────────────────┐
│  🧬 LIAE — Infrastructure Autopsy Engine          [● LIVE]  │
├─────────────────────────────────────────────────────────────┤
│  ← 30min ──────────[▓▓▓▓▓▓████░░░░]──────────── NOW →      │
│       ↑INCIDENT     ↑DEPLOY  ↑NOW                          │
├────────────┬────────────────────────────────────────────────┤
│  LAYERS    │  EVENT DETAILS                                  │
│  ── CPU    │  14:32:07 — nginx[1234] CPU 89%               │
│  ── MEM    │  14:32:08 — OOM killer: python[9021]           │
│  ── DISK   │  14:32:09 — Container webos-app restarted     │
│  ── NET    │  14:32:11 — K8s: Pod EVICTED                  │
│  ── K8s    │  14:32:14 — RDS Failover initiated            │
│  ── AWS    │                                                 │
│  ── AUTH   │  🤖 ROOT CAUSE: OOM → Container → K8s → RDS   │
└────────────┴────────────────────────────────────────────────┘
```

---

## 🌟 Why This Will WOW Everyone

1. **Never built before** — Not a single tool does all this unified in a browser
2. **Solves real pain** — Every DevOps/SRE team spends hours manually correlating logs during incidents
3. **Self-hosted & private** — No data leaves your server
4. **Live + historical** — Watch it live OR rewind to any past moment
5. **Cross-layer correlation** — OS + Containers + K8s + AWS in one view
6. **Beautiful UI** — Timeline scrubber, animated replay, causal chains
7. **AI hypotheses** — Automatic root cause detection
8. **Perfect fit** for this Ubuntu Web OS ecosystem you've built

---

## 🚀 Implementation Priority

| Phase | Features | Effort |
|---|---|---|
| Phase 1 | Background snapshot collector + Timeline scrubber UI | 2-3 days |
| Phase 2 | Multi-layer event grid + Process/File/Network layers | 2 days |
| Phase 3 | Causal chain detection + Root cause hypothesis | 2 days |
| Phase 4 | Animated replay mode + Snapshot diffing | 2 days |
| Phase 5 | K8s + AWS integration + PDF export | 2 days |

> **Start with Phase 1** and it's already impressive and unique. Each phase makes it progressively more powerful.

---

> **Bottom line:** This is the "black box recorder for servers" — something every sysadmin, DevOps engineer, and cloud architect has wished existed but no one has ever built in this form.
