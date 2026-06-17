// ═══════════════════════════════════════════════════════════
//  LIAE — Live Infrastructure Autopsy Engine
//  Client-side: timeline scrubber, layer rendering, replay
// ═══════════════════════════════════════════════════════════

const LIAE = (() => {
  // ── State ──────────────────────────────────────────────
  let timeline = [];         // array of lightweight timeline points
  let snapshots = {};        // cache: ts -> full snapshot
  let activeLayer = 'all';
  let scrubTs = null;        // currently selected timestamp (null = live)
  let isLive = true;
  let isReplaying = false;
  let replayInterval = null;
  let replaySpeedMs = 300;
  let pollInterval = null;
  let isDragging = false;
  let canvas = null;
  let ctx = null;
  let canvasW = 0;
  let canvasH = 0;
  let activeTab = 'events';  // events | processes | diff
  let diffAnchorTs = null;   // for diff mode

  // ── Layers config ──────────────────────────────────────
  const LAYERS = [
    { id: 'all',        label: 'All Events',   icon: 'fa-list',         color: '#00e5ff' },
    { id: 'cpu',        label: 'CPU',          icon: 'fa-microchip',    color: '#ef4444' },
    { id: 'memory',     label: 'Memory',       icon: 'fa-memory',       color: '#f59e0b' },
    { id: 'processes',  label: 'Processes',    icon: 'fa-gears',        color: '#8b5cf6' },
    { id: 'network',    label: 'Network',      icon: 'fa-network-wired',color: '#3b82f6' },
    { id: 'containers', label: 'Containers',   icon: 'fa-docker',       color: '#06b6d4' },
    { id: 'anomalies',  label: 'Anomalies',    icon: 'fa-triangle-exclamation', color: '#ef4444' },
  ];

  // ── API helper ─────────────────────────────────────────
  async function liaeApi(op, args = {}) {
    if (typeof apiCommand === 'function') {
      return await apiCommand(op, args);
    }
    throw new Error('apiCommand not available');
  }

  // ── Init ───────────────────────────────────────────────
  async function init() {
    canvas = document.getElementById('liae-timeline-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    setupCanvasResize();
    bindTimelineEvents();
    bindLayerItems();
    bindTabBar();
    bindControls();

    // Start the backend collector
    try {
      await liaeApi('liae_start');
    } catch(e) {
      console.warn('LIAE: Could not start backend collector:', e);
    }

    // Begin live polling
    startPolling();
    updateLivePill(true);
  }

  // ── Canvas resize ──────────────────────────────────────
  function setupCanvasResize() {
    const ro = new ResizeObserver(() => resizeCanvas());
    const wrap = document.getElementById('liae-timeline-wrap');
    if (wrap) ro.observe(wrap);
    resizeCanvas();
  }

  function resizeCanvas() {
    const wrap = document.getElementById('liae-timeline-wrap');
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvasW = canvas.width;
    canvasH = canvas.height;
    drawTimeline();
  }

  // ── Timeline drawing ───────────────────────────────────
  function drawTimeline() {
    if (!ctx || canvasW === 0) return;
    ctx.clearRect(0, 0, canvasW, canvasH);

    if (timeline.length === 0) {
      ctx.fillStyle = 'rgba(100,116,139,0.3)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Collecting snapshots…', canvasW / 2, canvasH / 2 + 4);
      return;
    }

    const firstTs = timeline[0].ts;
    const lastTs = timeline[timeline.length - 1].ts;
    const range = Math.max(lastTs - firstTs, 1);

    const slotW = canvasW / timeline.length;
    const barMaxH = canvasH - 10;

    timeline.forEach((pt, i) => {
      const x = (i / Math.max(timeline.length - 1, 1)) * (canvasW - slotW);

      // CPU bar  (key: 'cpu')
      const cpu = pt.cpu ?? pt.cpu_avg ?? 0;
      const cpuH = Math.max(2, (cpu / 100) * barMaxH * 0.7);
      const cpuColor = cpu > 80 ? '#ef4444' : cpu > 50 ? '#f59e0b' : '#1e3a5f';
      ctx.fillStyle = cpuColor;
      ctx.fillRect(x, canvasH - cpuH, Math.max(slotW - 0.5, 1), cpuH);

      // Memory overlay  (key: 'mem')
      const mem = pt.mem ?? pt.mem_pct ?? 0;
      const memH = Math.max(2, (mem / 100) * barMaxH * 0.5);
      ctx.fillStyle = 'rgba(139,92,246,0.35)';
      ctx.fillRect(x, canvasH - memH, Math.max(slotW - 0.5, 1), memH);

      // Anomaly markers  (key: 'hc' / 'ac')
      const hasCritical = pt.hc === 1 || pt.has_critical;
      const anomCount   = pt.ac  ?? pt.anomaly_count ?? 0;
      if (hasCritical) {
        ctx.fillStyle = 'rgba(239,68,68,0.9)';
        ctx.fillRect(x, 0, Math.max(slotW - 0.5, 1.5), 4);
      } else if (anomCount > 0) {
        ctx.fillStyle = 'rgba(245,158,11,0.8)';
        ctx.fillRect(x, 0, Math.max(slotW - 0.5, 1.5), 3);
      }
    });

    // Scrubber line
    if (!isLive && scrubTs !== null) {
      drawScrubber(scrubTs, firstTs, lastTs);
    } else if (isLive) {
      drawScrubber(lastTs, firstTs, lastTs);
    }

    updateTimelineLabels(firstTs, lastTs);
  }

  function drawScrubber(ts, firstTs, lastTs) {
    const range = Math.max(lastTs - firstTs, 1);
    const xPct = Math.max(0, Math.min(1, (ts - firstTs) / range));
    const x = xPct * canvasW;

    ctx.save();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasH);
    ctx.stroke();
    ctx.restore();

    // Update CSS scrubber position
    const scrubEl = document.getElementById('liae-scrubber-line');
    const tipEl = document.getElementById('liae-scrubber-tooltip');
    if (scrubEl && canvas) {
      const canvasRect = canvas.getBoundingClientRect();
      const wrapRect = document.getElementById('liae-timeline-wrap')?.getBoundingClientRect();
      if (wrapRect) {
        scrubEl.style.left = `${x}px`;
        if (tipEl) tipEl.textContent = new Date(ts * 1000).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    }
  }

  function updateTimelineLabels(firstTs, lastTs) {
    const leftEl = document.getElementById('liae-tl-left');
    const rightEl = document.getElementById('liae-tl-right');
    const fmt = ts => ts ? new Date(ts * 1000).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--';
    if (leftEl) leftEl.textContent = fmt(firstTs);
    if (rightEl) rightEl.textContent = fmt(lastTs);
  }

  // ── Timeline events (drag to scrub) ───────────────────
  function bindTimelineEvents() {
    const wrap = document.getElementById('liae-timeline-wrap');
    if (!wrap) return;

    wrap.addEventListener('mousedown', e => {
      isDragging = true;
      setLive(false);
      scrubFromEvent(e);
    });

    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      scrubFromEvent(e, wrap);
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    wrap.addEventListener('click', e => scrubFromEvent(e));
  }

  function scrubFromEvent(e, wrap) {
    const el = wrap || document.getElementById('liae-timeline-wrap');
    if (!el || timeline.length === 0) return;
    const rect = el.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const firstTs = timeline[0].ts;
    const lastTs = timeline[timeline.length - 1].ts;
    scrubTs = firstTs + xPct * (lastTs - firstTs);
    drawTimeline();
    loadSnapshotAt(scrubTs);
  }

  // ── Polling ────────────────────────────────────────────
  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      if (!isLive) return;
      await fetchTimeline();
    }, 1500);
    fetchTimeline(); // immediate first fetch
  }

  async function fetchTimeline() {
    try {
      const res = await liaeApi('liae_timeline');
      if (res.timeline && Array.isArray(res.timeline)) {
        timeline = res.timeline;
        updateSnapCount(res.count || timeline.length);
        drawTimeline();
        if (isLive) {
          loadLatestSnapshot();
        }
      }
    } catch(e) {
      // silent fail — backend may not be running
    }
  }

  async function loadLatestSnapshot() {
    try {
      const snap = await liaeApi('liae_current');
      if (snap && !snap.error) {
        scrubTs = snap.ts;
        renderSnapshot(snap);
      }
    } catch(e) {}
  }

  async function loadSnapshotAt(ts) {
    try {
      const snap = await liaeApi('liae_snapshot_at', { ts });
      if (snap && !snap.error) {
        renderSnapshot(snap);
      }
    } catch(e) {}
  }

  // ── Render a full snapshot into the UI ─────────────────
  function renderSnapshot(snap) {
    if (!snap) return;

    // Timestamp bar
    const tsEl = document.getElementById('liae-ts-value');
    const modeEl = document.getElementById('liae-ts-mode');
    if (tsEl) {
      const d = snap.ts ? new Date(snap.ts * 1000) : new Date();
      tsEl.textContent = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    if (modeEl) {
      modeEl.textContent = isLive ? '● LIVE' : '⏸ PAUSED';
      modeEl.style.color = isLive ? '#10b981' : '#f59e0b';
    }

    // Stats cards
    updateStats(snap);

    // Render active tab
    if (activeTab === 'events') {
      renderEventFeed(snap);
    } else if (activeTab === 'processes') {
      renderProcessTable(snap);
    }

    // Anomalies sidebar
    renderAnomalies(snap);

    // Root cause
    renderRootCause(snap);

    // Update layer badges
    updateLayerBadges(snap);
  }

  // ── Stats cards ────────────────────────────────────────
  function updateStats(snap) {
    const mem = snap.memory || {};
    let memPct = 0;
    if (mem.MemTotal && mem.MemAvailable) {
      memPct = Math.round(100 * (1 - mem.MemAvailable / mem.MemTotal));
    }
    const cpuTop = snap.processes && snap.processes.length > 0
      ? snap.processes[0].cpu.toFixed(1)
      : '0';
    const netConn = snap.network?.established ?? 0;
    const containers = snap.containers?.length ?? 0;

    setStatCard('liae-stat-cpu', cpuTop + '%', 'Top CPU');
    setStatCard('liae-stat-mem', memPct + '%', 'Memory');
    setStatCard('liae-stat-net', netConn, 'Connections');
    setStatCard('liae-stat-containers', containers, 'Containers');
  }

  function setStatCard(id, value, label) {
    const el = document.getElementById(id);
    if (!el) return;
    const valEl = el.querySelector('.liae-stat-value');
    const lblEl = el.querySelector('.liae-stat-label');
    if (valEl) valEl.textContent = value;
    if (lblEl) lblEl.textContent = label;
  }

  // ── Event feed ─────────────────────────────────────────
  function renderEventFeed(snap) {
    const panel = document.getElementById('liae-event-panel');
    if (!panel) return;

    const events = buildEventList(snap);
    const filtered = activeLayer === 'all'
      ? events
      : events.filter(e => e.layer === activeLayer);

    if (filtered.length === 0) {
      panel.innerHTML = `
        <div class="liae-empty">
          <i class="fa-solid fa-circle-check"></i>
          <div class="liae-empty-title">No events</div>
          <div class="liae-empty-sub">System nominal on this layer</div>
        </div>`;
      return;
    }

    const tsStr = snap.ts_str || '';
    panel.innerHTML = filtered.map(ev => `
      <div class="liae-event-row">
        <span class="liae-event-time">${tsStr}</span>
        <div class="liae-event-icon ${ev.iconClass}"><i class="fa-solid ${ev.icon}"></i></div>
        <div class="liae-event-body">
          <div class="liae-event-msg">${escHtml(ev.msg)}</div>
          ${ev.sub ? `<div class="liae-event-sub">${escHtml(ev.sub)}</div>` : ''}
        </div>
        <span class="liae-event-severity ${ev.severity}">${ev.severity}</span>
      </div>`).join('');
  }

  function buildEventList(snap) {
    const events = [];
    const ts = snap.ts_str || '';

    // CPU layer — top processes
    if (snap.processes && snap.processes.length > 0) {
      snap.processes.slice(0, 5).forEach(p => {
        if (p.cpu > 0.1) {
          events.push({
            layer: 'cpu',
            icon: 'fa-microchip',
            iconClass: p.cpu > 60 ? 'cpu' : 'ok',
            msg: `${p.cmd.slice(0, 55)} [PID ${p.pid}]`,
            sub: `CPU: ${p.cpu.toFixed(1)}%  MEM: ${p.mem.toFixed(1)}%  USER: ${p.user}`,
            severity: p.cpu > 80 ? 'critical' : p.cpu > 50 ? 'warning' : 'info',
          });
        }
      });
    }

    // Memory layer
    const mem = snap.memory || {};
    if (mem.MemTotal) {
      const pct = Math.round(100 * (1 - (mem.MemAvailable || 0) / mem.MemTotal));
      const freeMb = Math.round((mem.MemAvailable || 0) / 1024);
      events.push({
        layer: 'memory',
        icon: 'fa-memory',
        iconClass: pct > 90 ? 'cpu' : pct > 70 ? 'mem' : 'ok',
        msg: `Memory usage: ${pct}% used`,
        sub: `Free: ${freeMb} MB  |  Total: ${Math.round(mem.MemTotal / 1024)} MB`,
        severity: pct > 90 ? 'critical' : pct > 70 ? 'warning' : 'ok',
      });
    }

    // Network layer
    const net = snap.network || {};
    if (net.established !== undefined) {
      events.push({
        layer: 'network',
        icon: 'fa-network-wired',
        iconClass: 'net',
        msg: `Active TCP connections: ${net.established}`,
        sub: net.summary ? net.summary.split('\n')[0]?.trim() : '',
        severity: net.established > 500 ? 'warning' : 'info',
      });
    }

    // Containers layer
    if (snap.containers && snap.containers.length > 0) {
      snap.containers.forEach(c => {
        const isUp = c.status && c.status.toLowerCase().includes('up');
        events.push({
          layer: 'containers',
          icon: 'fa-box',
          iconClass: isUp ? 'container' : 'cpu',
          msg: `Container: ${c.name}`,
          sub: `Status: ${c.status}  Image: ${c.image}`,
          severity: isUp ? 'ok' : 'critical',
        });
      });
    } else {
      events.push({
        layer: 'containers',
        icon: 'fa-box',
        iconClass: 'ok',
        msg: 'No running containers detected',
        sub: 'Docker may not be running',
        severity: 'info',
      });
    }

    // Anomaly events
    if (snap.anomalies && snap.anomalies.length > 0) {
      snap.anomalies.forEach(a => {
        events.push({
          layer: 'anomalies',
          icon: 'fa-triangle-exclamation',
          iconClass: a.severity === 'critical' ? 'cpu' : 'mem',
          msg: a.msg,
          sub: `Anomaly type: ${a.type}`,
          severity: a.severity,
        });
      });
    }

    return events;
  }

  // ── Process table ──────────────────────────────────────
  function renderProcessTable(snap) {
    const panel = document.getElementById('liae-event-panel');
    if (!panel || !snap) return;
    const procs = snap.processes || [];

    if (procs.length === 0) {
      panel.innerHTML = `<div class="liae-empty"><i class="fa-solid fa-gears"></i><div class="liae-empty-title">No process data</div></div>`;
      return;
    }

    panel.innerHTML = `
      <table class="liae-proc-table">
        <thead>
          <tr>
            <th>PID</th>
            <th>USER</th>
            <th>CPU%</th>
            <th>MEM%</th>
            <th>COMMAND</th>
          </tr>
        </thead>
        <tbody>
          ${procs.slice(0, 30).map(p => `
            <tr>
              <td>${p.pid}</td>
              <td>${p.user}</td>
              <td>
                <div class="liae-mini-bar-wrap">
                  ${p.cpu.toFixed(1)}
                  <div class="liae-mini-bar">
                    <div class="liae-mini-bar-fill cpu" style="width:${Math.min(100,p.cpu)}%"></div>
                  </div>
                </div>
              </td>
              <td>
                <div class="liae-mini-bar-wrap">
                  ${p.mem.toFixed(1)}
                  <div class="liae-mini-bar">
                    <div class="liae-mini-bar-fill mem" style="width:${Math.min(100,p.mem*2)}%"></div>
                  </div>
                </div>
              </td>
              <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.65rem;color:var(--liae-text)">${escHtml(p.cmd)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  }

  // ── Anomalies sidebar ──────────────────────────────────
  function renderAnomalies(snap) {
    const panel = document.getElementById('liae-anomalies-panel');
    if (!panel) return;
    const anomalies = snap.anomalies || [];

    if (anomalies.length === 0) {
      panel.innerHTML = `
        <div style="padding:10px 8px;text-align:center;color:var(--liae-green);font-size:0.72rem;">
          <i class="fa-solid fa-shield-check" style="font-size:1.2rem;display:block;margin-bottom:6px;opacity:0.6;"></i>
          System nominal
        </div>`;
      return;
    }

    panel.innerHTML = anomalies.map(a => `
      <div class="liae-anomaly-card ${a.severity === 'critical' ? '' : 'warning'}">
        <div class="liae-anomaly-type">${a.type.replace(/_/g,' ')}</div>
        <div class="liae-anomaly-msg">${escHtml(a.msg)}</div>
      </div>`).join('');
  }

  // ── Root cause ─────────────────────────────────────────
  function renderRootCause(snap) {
    const panel = document.getElementById('liae-cause-panel');
    if (!panel) return;
    const anomalies = snap.anomalies || [];

    if (anomalies.length === 0) {
      panel.innerHTML = `<div style="padding:8px;font-size:0.68rem;color:var(--liae-muted);">No anomalies detected.</div>`;
      return;
    }

    // Build causal chain hypothesis
    const chain = buildCausalChain(snap);
    if (chain.length === 0) {
      panel.innerHTML = `<div style="padding:8px;font-size:0.68rem;color:var(--liae-muted);">Analyzing patterns…</div>`;
      return;
    }

    panel.innerHTML = `<div class="liae-cause-chain">` +
      chain.map((step, i) => `
        <div class="liae-cause-step">
          <i class="fa-solid ${i === 0 ? 'fa-circle-dot' : 'fa-arrow-turn-down-right'}"></i>
          <span>${escHtml(step)}</span>
        </div>
      `).join('') +
      `</div>`;
  }

  function buildCausalChain(snap) {
    const chain = [];
    const anomalies = snap.anomalies || [];
    const procs = snap.processes || [];

    // Find root trigger
    const oomAnomaly = anomalies.find(a => a.type === 'low_memory');
    const cpuAnomaly = anomalies.find(a => a.type === 'cpu_spike');
    const highCpuProc = procs.find(p => p.cpu > 70);
    const containers = snap.containers || [];
    const unhealthyContainers = containers.filter(c => c.status && !c.status.toLowerCase().includes('up'));

    if (oomAnomaly) {
      chain.push('Low memory detected (OOM risk)');
      if (highCpuProc) chain.push(`CPU spike: ${highCpuProc.cmd.slice(0,35)}…`);
      if (unhealthyContainers.length > 0) chain.push(`Container degraded: ${unhealthyContainers[0].name}`);
      chain.push('Risk: Kernel OOM killer activation');
    } else if (cpuAnomaly) {
      chain.push('CPU spike detected');
      if (highCpuProc) chain.push(`Offending process: ${highCpuProc.cmd.slice(0,35)}`);
      chain.push('Potential: I/O wait or runaway thread');
    } else if (anomalies.length > 0) {
      anomalies.forEach(a => chain.push(a.msg.slice(0, 55)));
    }

    return chain;
  }

  // ── Layer badges ───────────────────────────────────────
  function updateLayerBadges(snap) {
    const anomalyCount = snap.anomalies?.length || 0;
    const hasCritical = snap.anomalies?.some(a => a.severity === 'critical') || false;
    const anomBadge = document.getElementById('liae-badge-anomalies');
    if (anomBadge) {
      anomBadge.textContent = anomalyCount;
      anomBadge.className = `liae-layer-badge ${hasCritical ? 'critical' : anomalyCount > 0 ? 'warning' : ''}`;
    }
    const contBadge = document.getElementById('liae-badge-containers');
    if (contBadge) contBadge.textContent = snap.containers?.length || 0;
    const procBadge = document.getElementById('liae-badge-processes');
    if (procBadge) procBadge.textContent = snap.processes?.length || 0;
  }

  function updateSnapCount(count) {
    const el = document.getElementById('liae-snap-count');
    if (el) el.textContent = `${count} snaps`;
  }

  // ── Live/Pause toggle ──────────────────────────────────
  function setLive(live) {
    isLive = live;
    updateLivePill(live);
    const dot = document.querySelector('.liae-live-dot');
    if (dot) dot.classList.toggle('paused', !live);
    const pill = document.getElementById('liae-live-pill');
    if (pill) pill.textContent = live ? '● LIVE' : '⏸ PAUSED';
    const modeEl = document.getElementById('liae-ts-mode');
    if (modeEl) {
      modeEl.textContent = live ? '● LIVE' : '⏸ PAUSED';
      modeEl.style.color = live ? '#10b981' : '#f59e0b';
    }
  }

  function updateLivePill(live) {
    const pill = document.getElementById('liae-live-pill-wrap');
    if (!pill) return;
    if (live) {
      pill.innerHTML = `<div class="liae-live-dot" id="liae-live-dot"></div><span id="liae-live-pill">● LIVE</span>`;
    } else {
      pill.innerHTML = `<div class="liae-live-dot paused" id="liae-live-dot"></div><span id="liae-live-pill">⏸ PAUSED</span>`;
    }
  }

  // ── Replay ─────────────────────────────────────────────
  function startReplay() {
    if (isReplaying || timeline.length < 2) return;
    isReplaying = true;
    setLive(false);
    let idx = 0;
    const replayBar = document.getElementById('liae-replay-bar');
    if (replayBar) replayBar.classList.add('visible');

    replayInterval = setInterval(async () => {
      if (idx >= timeline.length) {
        stopReplay();
        return;
      }
      const pt = timeline[idx];
      scrubTs = pt.ts;
      drawTimeline();
      await loadSnapshotAt(pt.ts);
      idx++;

      const speedEl = document.getElementById('liae-replay-frame');
      if (speedEl) speedEl.textContent = `${idx} / ${timeline.length}`;
    }, replaySpeedMs);
  }

  function stopReplay() {
    isReplaying = false;
    if (replayInterval) clearInterval(replayInterval);
    replayInterval = null;
    const replayBar = document.getElementById('liae-replay-bar');
    if (replayBar) replayBar.classList.remove('visible');
  }

  // ── Diff mode ──────────────────────────────────────────
  async function computeDiff() {
    if (timeline.length < 2) return;
    const ts2 = scrubTs || (timeline.length > 0 ? timeline[timeline.length - 1].ts : 0);
    const ts1 = timeline[0].ts;

    const panel = document.getElementById('liae-event-panel');
    if (panel) panel.innerHTML = `<div class="liae-empty"><div class="liae-spinner"></div><div class="liae-empty-sub">Computing diff…</div></div>`;

    try {
      const diff = await liaeApi('liae_diff', { ts1, ts2 });
      if (panel) {
        const newProcs = diff.new_processes || [];
        const goneProcs = diff.gone_processes || [];
        const memDelta = diff.memory_delta?.available_kb_change || 0;
        const netDelta = diff.network_delta?.connection_change || 0;

        panel.innerHTML = `
          <div style="padding:10px 12px;font-size:0.72rem;color:var(--liae-muted);border-bottom:1px solid rgba(255,255,255,0.04);">
            Diff: <span style="color:var(--liae-cyan)">${diff.t1 || '?'}</span>
            → <span style="color:var(--liae-cyan)">${diff.t2 || '?'}</span>
          </div>
          <div class="liae-layer-section-title">Memory</div>
          <div class="liae-diff-section">
            <div class="liae-diff-row">
              <span class="liae-diff-tag ${memDelta >= 0 ? 'new' : 'gone'}">${memDelta >= 0 ? '+' : ''}${Math.round(memDelta/1024)} MB</span>
              <span style="color:var(--liae-text)">Available memory delta</span>
            </div>
            <div class="liae-diff-row">
              <span class="liae-diff-tag ${netDelta >= 0 ? 'new' : 'gone'}">${netDelta >= 0 ? '+' : ''}${netDelta}</span>
              <span style="color:var(--liae-text)">Network connection delta</span>
            </div>
          </div>
          ${newProcs.length > 0 ? `
            <div class="liae-layer-section-title">New Processes</div>
            <div class="liae-diff-section">
              ${newProcs.slice(0,10).map(p => `
                <div class="liae-diff-row">
                  <span class="liae-diff-tag new">+NEW</span>
                  <span style="color:var(--liae-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">[${p.pid}] ${escHtml(p.cmd)}</span>
                </div>`).join('')}
            </div>` : ''}
          ${goneProcs.length > 0 ? `
            <div class="liae-layer-section-title">Terminated Processes</div>
            <div class="liae-diff-section">
              ${goneProcs.slice(0,10).map(p => `
                <div class="liae-diff-row">
                  <span class="liae-diff-tag gone">-END</span>
                  <span style="color:var(--liae-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">[${p.pid}] ${escHtml(p.cmd)}</span>
                </div>`).join('')}
            </div>` : ''}
          ${newProcs.length === 0 && goneProcs.length === 0 ? `
            <div class="liae-empty" style="padding:20px">
              <i class="fa-solid fa-equals"></i>
              <div class="liae-empty-title">Identical process state</div>
              <div class="liae-empty-sub">No process changes detected</div>
            </div>` : ''}`;
      }
    } catch(e) {
      if (panel) panel.innerHTML = `<div class="liae-empty"><i class="fa-solid fa-xmark"></i><div class="liae-empty-sub">Diff error: ${e.message}</div></div>`;
    }
  }

  // ── Tab bar ────────────────────────────────────────────
  function bindTabBar() {
    document.querySelectorAll('#win-liae .liae-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        document.querySelectorAll('#win-liae .liae-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (activeTab === 'diff') {
          computeDiff();
        } else {
          loadLatestSnapshot();
        }
      });
    });
  }

  // ── Layer items ────────────────────────────────────────
  function bindLayerItems() {
    document.querySelectorAll('#win-liae .liae-layer-item').forEach(item => {
      item.addEventListener('click', () => {
        activeLayer = item.dataset.layer;
        document.querySelectorAll('#win-liae .liae-layer-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        if (activeTab !== 'diff') loadLatestSnapshot();
      });
    });
  }

  // ── Controls ───────────────────────────────────────────
  function bindControls() {
    const btnLive = document.getElementById('liae-btn-live');
    if (btnLive) btnLive.addEventListener('click', () => {
      stopReplay();
      setLive(true);
    });

    const btnReplay = document.getElementById('liae-btn-replay');
    if (btnReplay) btnReplay.addEventListener('click', () => {
      if (isReplaying) stopReplay();
      else startReplay();
      btnReplay.classList.toggle('active', isReplaying);
    });

    const btnPause = document.getElementById('liae-btn-pause');
    if (btnPause) btnPause.addEventListener('click', () => setLive(false));

    const btnRefresh = document.getElementById('liae-btn-refresh');
    if (btnRefresh) btnRefresh.addEventListener('click', () => fetchTimeline());
  }

  // ── Utility ────────────────────────────────────────────
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Public ─────────────────────────────────────────────
  return {
    init,
    stop() {
      if (pollInterval) clearInterval(pollInterval);
      stopReplay();
    },
    refresh: fetchTimeline,
  };
})();

// LIAE init is triggered by app.js openWindow('liae') — no wrapper needed here.
