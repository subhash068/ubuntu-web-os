// ═══════════════════════════════════════════════════════════
//  SPY NETWORK — Identity Rotator + Network Intelligence
//  Fetches your real public IP from multiple sources,
//  rotates the active source every 5 seconds, shows geo info,
//  and logs all events to a live console.
// ═══════════════════════════════════════════════════════════

const SPY = (() => {
  // ── IP lookup sources (Simulated Proxy Nodes) ───────────────
  const SOURCES = [
    { id: 'node_alpha',  label: 'Proxy Relay Alpha' },
    { id: 'node_beta',   label: 'Proxy Relay Beta' },
    { id: 'exit_gamma',  label: 'Onion Exit Gamma' },
    { id: 'node_delta',  label: 'Bouncer Node Delta' },
    { id: 'vpn_epsilon', label: 'VPN Tunnel Epsilon' },
    { id: 'relay_zeta',  label: 'Darknet Relay Zeta' },
    { id: 'proxy_omega', label: 'Proxy Node Omega' },
  ];

  // ── Global Geo Mock Data ───────────────────────────────────
  const MOCK_GEO = [
    { country: 'Russia', city: 'Moscow', region: 'Moscow City', isp: 'Rostelecom', tz: 'Europe/Moscow', lat: 55.75, lon: 37.61, code: 'RU' },
    { country: 'China', city: 'Beijing', region: 'Beijing', isp: 'China Telecom', tz: 'Asia/Shanghai', lat: 39.90, lon: 116.40, code: 'CN' },
    { country: 'United States', city: 'Seattle', region: 'Washington', isp: 'Amazon.com', tz: 'America/Los_Angeles', lat: 47.60, lon: -122.33, code: 'US' },
    { country: 'Germany', city: 'Frankfurt', region: 'Hesse', isp: 'Hetzner Online', tz: 'Europe/Berlin', lat: 50.11, lon: 8.68, code: 'DE' },
    { country: 'Brazil', city: 'São Paulo', region: 'São Paulo', isp: 'Claro S.A.', tz: 'America/Sao_Paulo', lat: -23.55, lon: -46.63, code: 'BR' },
    { country: 'Japan', city: 'Tokyo', region: 'Tokyo', isp: 'NTT Communications', tz: 'Asia/Tokyo', lat: 35.67, lon: 139.65, code: 'JP' },
    { country: 'India', city: 'Mumbai', region: 'Maharashtra', isp: 'Jio', tz: 'Asia/Kolkata', lat: 19.07, lon: 72.87, code: 'IN' },
    { country: 'Netherlands', city: 'Amsterdam', region: 'North Holland', isp: 'KPN', tz: 'Europe/Amsterdam', lat: 52.36, lon: 4.90, code: 'NL' },
    { country: 'South Africa', city: 'Cape Town', region: 'Western Cape', isp: 'Telkom SA', tz: 'Africa/Johannesburg', lat: -33.92, lon: 18.42, code: 'ZA' },
    { country: 'Australia', city: 'Sydney', region: 'NSW', isp: 'Telstra', tz: 'Australia/Sydney', lat: -33.86, lon: 151.20, code: 'AU' },
    { country: 'Switzerland', city: 'Zurich', region: 'Zurich', isp: 'Swisscom', tz: 'Europe/Zurich', lat: 47.37, lon: 8.54, code: 'CH' },
    { country: 'Canada', city: 'Toronto', region: 'Ontario', isp: 'Bell Canada', tz: 'America/Toronto', lat: 43.65, lon: -79.38, code: 'CA' },
    { country: 'Singapore', city: 'Singapore', region: 'Singapore', isp: 'Singtel', tz: 'Asia/Singapore', lat: 1.35, lon: 103.81, code: 'SG' },
    { country: 'United Kingdom', city: 'London', region: 'England', isp: 'Vodafone', tz: 'Europe/London', lat: 51.50, lon: -0.12, code: 'GB' },
    { country: 'France', city: 'Paris', region: 'Île-de-France', isp: 'Orange', tz: 'Europe/Paris', lat: 48.85, lon: 2.35, code: 'FR' },
    { country: 'South Korea', city: 'Seoul', region: 'Seoul', isp: 'KT Corporation', tz: 'Asia/Seoul', lat: 37.56, lon: 126.97, code: 'KR' },
    { country: 'Sweden', city: 'Stockholm', region: 'Stockholm', isp: 'Telia Company', tz: 'Europe/Stockholm', lat: 59.32, lon: 18.06, code: 'SE' },
    { country: 'Israel', city: 'Tel Aviv', region: 'Tel Aviv', isp: 'Bezeq', tz: 'Asia/Jerusalem', lat: 32.08, lon: 34.78, code: 'IL' }
  ];

  function randomPublicIP() {
    const r = () => Math.floor(Math.random() * 254) + 1;
    let ip;
    do {
      ip = `${r()}.${r()}.${r()}.${r()}`;
    } while (
      ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.') || ip.startsWith('169.254.') || 
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) || /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(ip)
    );
    return ip;
  }

  // ── State ──────────────────────────────────────────────────
  let sourceResults  = {};   // { sourceId: { ip, status } }
  let activeSourceIdx = 0;
  let rotateTimer    = null;
  let progressTimer  = null;
  let progressStart  = 0;
  let isRotating     = false;
  let rotateInterval = 5000;  // ms
  let rotationCount  = 0;
  let totalChecks    = 0;
  let geoCache       = {};   // ip -> geo data
  let currentGeo     = null;
  let netResults     = [];
  let activeTab      = 'identity';

  // ── DOM helpers ────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

  // ── Init ───────────────────────────────────────────────────
  function init() {
    if (!$('spy-ip-value')) return;  // not in DOM yet
    renderSourceList();
    startAllFetches();
    if (!isRotating) startRotation();
    bindTabs();
    bindControls();
    log('sys', 'SPY NETWORK', 'System online — identity rotator armed');
    log('info', 'INIT', `Querying <em>${SOURCES.length}</em> IP lookup sources`);
    setTimeout(() => fetchNetworkInterfaces(), 500);
  }

  // ── Fetch all sources ──────────────────────────────────────
  async function startAllFetches() {
    for (const src of SOURCES) {
      fetchSource(src);
    }
  }

  async function fetchSource(src) {
    sourceResults[src.id] = { ip: null, status: 'loading' };
    renderSourceList();
    
    // Simulate network delay for realism
    await new Promise(r => setTimeout(r, Math.random() * 800 + 200));

    // 10% chance to fail to mimic unstable nodes
    if (Math.random() < 0.1) {
      sourceResults[src.id] = { ip: null, status: 'error' };
      log('warn', src.label, 'Connection refused by peer');
    } else {
      const ip = randomPublicIP();
      sourceResults[src.id] = { ip, status: 'ok' };
      totalChecks++;
      log('ok', src.label, `Tunnel established → <em>${ip}</em>`);
    }
    
    renderSourceList();
    updateStats();
  }

  // ── Rotation ───────────────────────────────────────────────
  function startRotation() {
    isRotating = true;
    updateRotationBtn();
    clearInterval(rotateTimer);
    clearInterval(progressTimer);
    rotateTimer = setInterval(rotate, rotateInterval);
    startProgressBar();
    rotate();  // immediate first rotate
  }

  function stopRotation() {
    isRotating = false;
    clearInterval(rotateTimer);
    clearInterval(progressTimer);
    updateRotationBtn();
    resetProgressBar();
  }

  function rotate() {
    // Find next source with a valid IP
    let tries = 0;
    let next = activeSourceIdx;
    do {
      next = (next + 1) % SOURCES.length;
      tries++;
    } while (tries < SOURCES.length && sourceResults[SOURCES[next].id]?.status !== 'ok');

    // If none found yet, stay on current
    const hasSome = Object.values(sourceResults).some(r => r.status === 'ok');
    if (!hasSome) return;

    activeSourceIdx = next;
    rotationCount++;

    const src = SOURCES[activeSourceIdx];
    const ip  = sourceResults[src.id]?.ip;

    if (ip) {
      updateIPDisplay(ip, src);
      fetchGeo(ip);
      log('info', 'ROTATE', `Identity switched → <em>${src.label}</em> [${ip}]`);
    }

    renderSourceList();
    updateStats();
    startProgressBar();
  }

  function startProgressBar() {
    const fill = $('spy-progress-fill');
    if (!fill) return;
    clearInterval(progressTimer);
    progressStart = Date.now();
    fill.style.transition = 'none';
    fill.style.width = '0%';
    requestAnimationFrame(() => {
      fill.style.transition = `width ${rotateInterval}ms linear`;
      fill.style.width = '100%';
    });
  }

  function resetProgressBar() {
    const fill = $('spy-progress-fill');
    if (!fill) return;
    fill.style.transition = 'none';
    fill.style.width = '0%';
  }

  function updateRotationBtn() {
    const btn = $('spy-btn-rotate');
    if (!btn) return;
    btn.classList.toggle('active', isRotating);
    btn.innerHTML = isRotating
      ? '<i class="fa-solid fa-circle-stop"></i> Stop'
      : '<i class="fa-solid fa-rotate"></i> Rotate';
  }

  // ── IP display animation ───────────────────────────────────
  function updateIPDisplay(ip, src) {
    const valEl = $('spy-ip-value');
    const subEl = $('spy-ip-sub');
    const srcEl = $('spy-ip-source');
    if (!valEl) return;

    valEl.classList.add('switching');
    setTimeout(() => {
      valEl.textContent = ip;
      valEl.classList.remove('switching');
    }, 160);
    if (subEl) subEl.textContent = currentGeo ? `${currentGeo.city}, ${currentGeo.country}` : 'Resolving location…';
    if (srcEl) srcEl.textContent = `via ${src.label}`;
    if ($('spy-ip-val')) $('spy-ip-val').textContent = ip;  // taskbar update
  }

  // ── Geo lookup ─────────────────────────────────────────────
  async function fetchGeo(ip) {
    if (geoCache[ip]) { applyGeo(geoCache[ip]); return; }
    
    // Simulate Geo lookup delay
    await new Promise(r => setTimeout(r, Math.random() * 400 + 100));
    
    const d = MOCK_GEO[Math.floor(Math.random() * MOCK_GEO.length)];
    
    // Add tiny random jitter to coordinates
    const jLat = (Math.random() * 0.05 - 0.025).toFixed(3);
    const jLon = (Math.random() * 0.05 - 0.025).toFixed(3);
    
    const geo = {
      ip:       ip,
      country:  d.country,
      city:     d.city,
      region:   d.region,
      isp:      d.isp,
      timezone: d.tz,
      lat:      (d.lat + parseFloat(jLat)).toFixed(3),
      lon:      (d.lon + parseFloat(jLon)).toFixed(3),
      flag:     countryFlag(d.code),
    };
    
    geoCache[ip] = geo;
    applyGeo(geo);
  }

  function applyGeo(geo) {
    currentGeo = geo;
    setGeo('spy-geo-country',  `${geo.flag} ${geo.country}`);
    setGeo('spy-geo-city',     geo.city);
    setGeo('spy-geo-region',   geo.region);
    setGeo('spy-geo-isp',      geo.isp);
    setGeo('spy-geo-timezone', geo.timezone);
    setGeo('spy-geo-coords',   geo.lat && geo.lon ? `${Number(geo.lat).toFixed(3)}, ${Number(geo.lon).toFixed(3)}` : '—');
    const subEl = $('spy-ip-sub');
    if (subEl) subEl.textContent = `${geo.city}, ${geo.country}`;
  }

  function setGeo(id, val) {
    const e = $(id);
    if (e) e.textContent = val || '—';
  }

  // ── Source list rendering ──────────────────────────────────
  function renderSourceList() {
    const list = $('spy-source-list');
    if (!list) return;
    list.innerHTML = '';
    SOURCES.forEach((src, i) => {
      const res = sourceResults[src.id] || { status: 'pending' };
      const isActive = i === activeSourceIdx;
      const row = el('div', `spy-source-item${isActive ? ' active-source' : ''}`);
      const nameSpan = el('span', '', src.label);
      nameSpan.style.flex = '1';
      nameSpan.style.overflow = 'hidden';
      nameSpan.style.textOverflow = 'ellipsis';
      nameSpan.style.whiteSpace = 'nowrap';
      const ipSpan = el('span', 'spy-source-ip' + (res.status === 'loading' ? ' loading' : ''));
      if (res.status === 'ok')      ipSpan.textContent = res.ip || '—';
      else if (res.status === 'loading') ipSpan.textContent = '…';
      else if (res.status === 'error')   { ipSpan.textContent = 'ERR'; ipSpan.style.color = 'var(--spy-red)'; }
      else                                ipSpan.textContent = 'pending';
      row.appendChild(nameSpan);
      row.appendChild(ipSpan);
      list.appendChild(row);
    });
    // rotation counter
    const ctr = $('spy-rotation-counter');
    if (ctr) ctr.innerHTML = `Rotations: <span>${rotationCount}</span>  ·  Checks: <span>${totalChecks}</span>`;
  }

  // ── Stats ──────────────────────────────────────────────────
  function updateStats() {
    const ok  = Object.values(sourceResults).filter(r => r.status === 'ok').length;
    const err = Object.values(sourceResults).filter(r => r.status === 'error').length;
    setText('spy-stat-ok',  ok);
    setText('spy-stat-err', err);
    setText('spy-stat-rot', rotationCount);
    setText('spy-stat-src', SOURCES.length);
  }

  function setText(id, val) {
    const e = $(id);
    if (e) e.textContent = val;
  }

  // ── Network interfaces ─────────────────────────────────────
  async function fetchNetworkInterfaces() {
    const pane = $('spy-net-pane');
    if (!pane) return;
    try {
      const data = await apiCommand('run_raw', { command: 'ip addr show 2>/dev/null || ifconfig 2>/dev/null' }).catch(() => null);
      if (data && data.stdout) {
        renderNetTable(data.stdout);
        log('ok', 'NET', 'Network interfaces loaded');
      } else {
        const d2 = await apiCommand('cmd', { cmd: 'ip addr show 2>/dev/null || ifconfig 2>/dev/null' }).catch(() => null);
        if (d2 && d2.stdout) renderNetTable(d2.stdout);
      }
    } catch(e) {
      log('warn', 'NET', 'Interface scan unavailable (backend not connected)');
    }
  }

  function renderNetTable(raw) {
    const pane = $('spy-net-pane');
    if (!pane) return;
    // Parse ip addr / ifconfig output
    const ifaces = parseInterfaces(raw);
    netResults = ifaces;
    if (ifaces.length === 0) {
      pane.innerHTML = `<div class="spy-empty"><i class="fa-solid fa-network-wired" style="font-size:1.5rem;opacity:0.3"></i><div>No interfaces detected</div></div>`;
      return;
    }
    const table = el('table', 'spy-net-table');
    table.innerHTML = `<thead><tr><th>Interface</th><th>IP Address</th><th>Status</th><th>Type</th></tr></thead>`;
    const tbody = el('tbody');
    ifaces.forEach(iface => {
      const tr = el('tr');
      const isUp = iface.status.toLowerCase().includes('up');
      tr.innerHTML = `
        <td style="color:var(--spy-green);font-weight:700">${iface.name}</td>
        <td>${iface.ip || '<span style="color:var(--spy-dim)">no addr</span>'}</td>
        <td><span class="${isUp?'up-badge':'down-badge'}">${iface.status}</span></td>
        <td style="color:var(--spy-dim)">${iface.type}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    pane.innerHTML = '';
    pane.appendChild(table);
  }

  function parseInterfaces(raw) {
    const ifaces = [];
    // Try ip addr format first
    const blocks = raw.split(/\n(?=\d+:)/);
    if (blocks.length > 1) {
      blocks.forEach(block => {
        const nameM = block.match(/\d+:\s+(\S+):/);
        const ipM   = block.match(/inet\s+([\d.]+)/);
        const stateM= block.match(/state\s+(\S+)/i) || block.match(/<([^>]*)>/);
        if (nameM) {
          ifaces.push({
            name: nameM[1].replace('@NONE','').replace('@',''),
            ip:   ipM ? ipM[1] : null,
            status: stateM ? (stateM[1].includes('UP') || stateM[1].includes('LOWER_UP') ? 'UP' : 'DOWN') : 'UNKNOWN',
            type: block.includes('loopback') ? 'loopback' : block.includes('ether') ? 'ethernet' : 'virtual',
          });
        }
      });
    } else {
      // ifconfig format
      const ifblocks = raw.split(/\n\n+/);
      ifblocks.forEach(block => {
        const nameM = block.match(/^(\S+)/m);
        const ipM   = block.match(/inet\s+(?:addr:)?([\d.]+)/);
        if (nameM) {
          ifaces.push({
            name: nameM[1].replace(':',''),
            ip:   ipM ? ipM[1] : null,
            status: block.includes('UP') ? 'UP' : 'DOWN',
            type: block.includes('Loop') ? 'loopback' : 'ethernet',
          });
        }
      });
    }
    return ifaces;
  }

  // ── Console log ────────────────────────────────────────────
  function log(type, tag, msg) {
    const panel = $('spy-console');
    if (!panel) return;
    const row = el('div', 'spy-log-row');
    const now = new Date();
    const ts  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    row.innerHTML = `
      <span class="spy-log-ts">${ts}</span>
      <span class="spy-log-tag ${type}">${tag}</span>
      <span class="spy-log-msg">${msg}</span>`;
    panel.insertBefore(row, panel.firstChild);
    // Trim to 200 lines
    while (panel.children.length > 200) panel.removeChild(panel.lastChild);
  }

  // ── Flag helper ────────────────────────────────────────────
  function countryFlag(code) {
    if (!code || code.length !== 2) return '🌐';
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }

  // ── Tab binding ────────────────────────────────────────────
  function bindTabs() {
    document.querySelectorAll('#win-spy .spy-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        document.querySelectorAll('#win-spy .spy-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('#win-spy .spy-pane').forEach(p => p.classList.remove('active'));
        const pane = $(`spy-pane-${activeTab}`);
        if (pane) pane.classList.add('active');
        if (activeTab === 'network') fetchNetworkInterfaces();
      });
    });
  }

  // ── Controls ───────────────────────────────────────────────
  function bindControls() {
    const rotateBtn = $('spy-btn-rotate');
    if (rotateBtn) rotateBtn.addEventListener('click', () => {
      if (isRotating) stopRotation();
      else startRotation();
    });

    const nextBtn = $('spy-btn-next');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      startProgressBar();
      rotate();
    });

    const refreshBtn = $('spy-btn-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
      sourceResults = {};
      totalChecks = 0;
      geoCache = {};
      currentGeo = null;
      renderSourceList();
      updateStats();
      log('sys', 'REFRESH', 'Re-establishing all proxy tunnels…');
      startAllFetches();
    });

    const intervalSel = $('spy-interval-sel');
    if (intervalSel) intervalSel.addEventListener('change', () => {
      rotateInterval = parseInt(intervalSel.value) * 1000;
      if (isRotating) { clearInterval(rotateTimer); rotateTimer = setInterval(rotate, rotateInterval); startProgressBar(); }
      log('sys', 'CONFIG', `Rotation interval set to <em>${intervalSel.value}s</em>`);
    });
  }

  // ── Public ─────────────────────────────────────────────────
  return { init, stop: stopRotation };
})();
