// ═══════════════════════════════════════════════════════
//  SPY NETWORK — IP Rotation Engine
//  Cycles fake IPs on the taskbar badge every N seconds.
//  Shows routing path, connection log, latency stats.
// ═══════════════════════════════════════════════════════

const SpyNet = (() => {

  // ── IP Pool — Countries × Subnets ──────────────────────
  const IP_POOL = [
    { country: 'Germany',       flag: '🇩🇪', isp: 'Deutsche Telekom', subnets: ['91.65.','217.0.','85.176.','79.197.'] },
    { country: 'Japan',         flag: '🇯🇵', isp: 'NTT Communications', subnets: ['126.0.','61.197.','219.101.','153.121.'] },
    { country: 'United States', flag: '🇺🇸', isp: 'Comcast', subnets: ['104.28.','173.245.','192.168.','198.41.'] },
    { country: 'Netherlands',   flag: '🇳🇱', isp: 'KPN B.V.', subnets: ['145.99.','213.154.','194.151.','80.101.'] },
    { country: 'Singapore',     flag: '🇸🇬', isp: 'StarHub', subnets: ['116.89.','203.116.','112.199.','175.139.'] },
    { country: 'Brazil',        flag: '🇧🇷', isp: 'Claro S.A.', subnets: ['177.37.','200.178.','186.216.','189.28.'] },
    { country: 'Canada',        flag: '🇨🇦', isp: 'Rogers Cable', subnets: ['66.185.','142.116.','70.50.','206.75.'] },
    { country: 'France',        flag: '🇫🇷', isp: 'Orange S.A.', subnets: ['90.61.','82.67.','78.197.','109.14.'] },
    { country: 'South Korea',   flag: '🇰🇷', isp: 'SK Broadband', subnets: ['221.148.','175.197.','114.207.','59.8.'] },
    { country: 'United Kingdom',flag: '🇬🇧', isp: 'BT Group', subnets: ['86.150.','81.107.','80.3.','77.98.'] },
    { country: 'Sweden',        flag: '🇸🇪', isp: 'Tele2', subnets: ['81.226.','83.255.','90.227.','194.0.'] },
    { country: 'Australia',     flag: '🇦🇺', isp: 'Telstra', subnets: ['139.130.','203.41.','43.250.','101.160.'] },
    { country: 'Russia',        flag: '🇷🇺', isp: 'Rostelecom', subnets: ['87.226.','79.135.','91.240.','188.43.'] },
    { country: 'India',         flag: '🇮🇳', isp: 'Jio Fiber', subnets: ['49.36.','117.242.','103.48.','122.176.'] },
    { country: 'Switzerland',   flag: '🇨🇭', isp: 'Swisscom', subnets: ['195.65.','31.10.','83.150.','80.218.'] },
    { country: 'Norway',        flag: '🇳🇴', isp: 'Telenor', subnets: ['84.208.','87.238.','91.220.','193.69.'] },
    { country: 'Hong Kong',     flag: '🇭🇰', isp: 'HKT', subnets: ['103.11.','123.176.','210.0.','61.244.'] },
    { country: 'South Africa',  flag: '🇿🇦', isp: 'Vodacom', subnets: ['41.0.','196.22.','197.80.','102.0.'] },
    { country: 'Mexico',        flag: '🇲🇽', isp: 'Telmex', subnets: ['187.190.','200.56.','148.236.','201.175.'] },
    { country: 'Iceland',       flag: '🇮🇸', isp: 'Siminn', subnets: ['193.4.','82.221.','80.248.','46.182.'] },
  ];

  // ── State ───────────────────────────────────────────────
  let isRunning = false;
  let intervalMs = 5000;
  let rotationTimer = null;
  let countdownTimer = null;
  let countdownMs = 0;
  let log = [];          // { ts, ip, entry } rotation log
  let totalRotations = 0;
  let currentEntry = null;
  let routeCanvas = null;
  let routeCtx = null;
  let routeAnimFrame = null;
  let routeNodes = [];   // animated hop nodes
  let routePackets = []; // animated packets

  // ── Helpers ─────────────────────────────────────────────
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function generateIp(entry) {
    const subnet = entry.subnets[randInt(0, entry.subnets.length - 1)];
    return subnet + randInt(1, 254) + '.' + randInt(1, 254);
  }

  function fakeLatency() { return randInt(8, 280); }

  function nowStr() {
    return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function pickRandomEntry(exclude) {
    let e;
    do { e = IP_POOL[randInt(0, IP_POOL.length - 1)]; } while (e === exclude && IP_POOL.length > 1);
    return e;
  }

  // ── Taskbar override ────────────────────────────────────
  function setTaskbarIp(ip) {
    const el = document.getElementById('ip-val');
    const badge = document.getElementById('ip-badge');
    if (el) el.textContent = ip;
    if (badge) badge.classList.add('spy-active');
    if (el) el.classList.add('spy-active');
  }

  function clearTaskbarOverride() {
    const el = document.getElementById('ip-val');
    const badge = document.getElementById('ip-badge');
    if (badge) badge.classList.remove('spy-active');
    if (el) el.classList.remove('spy-active');
    // Restore real IP
    if (typeof fetchPublicIp === 'function') fetchPublicIp();
  }

  // ── Rotation logic ──────────────────────────────────────
  function rotate() {
    const entry = pickRandomEntry(currentEntry);
    const ip = generateIp(entry);
    const latency = fakeLatency();
    currentEntry = entry;

    // Update taskbar
    const ipEl = document.getElementById('ip-val');
    if (ipEl) {
      ipEl.classList.remove('changing');
      void ipEl.offsetWidth; // reflow
      ipEl.classList.add('spy-ip-value', 'changing');
    }
    setTimeout(() => setTaskbarIp(ip), 200);

    // Update main IP display
    updateIpDisplay(ip, entry, latency);

    // Add to log
    const logEntry = { ts: nowStr(), ip, entry, latency };
    log.unshift(logEntry);
    if (log.length > 200) log.pop();
    totalRotations++;

    renderLog();
    updateStats();
    addRoutePacket();
  }

  function start(ms) {
    if (isRunning) stop();
    intervalMs = ms || intervalMs;
    isRunning = true;
    rotate(); // immediate first rotation
    rotationTimer = setInterval(rotate, intervalMs);
    countdownMs = intervalMs;
    countdownTimer = setInterval(() => {
      countdownMs -= 100;
      if (countdownMs < 0) countdownMs = intervalMs;
      updateTimerBar();
    }, 100);
    updateUI();
  }

  function stop() {
    isRunning = false;
    if (rotationTimer) clearInterval(rotationTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    rotationTimer = null;
    countdownTimer = null;
    clearTaskbarOverride();
    updateUI();
    resetTimerBar();
  }

  // ── UI updates ──────────────────────────────────────────
  function updateIpDisplay(ip, entry, latency) {
    const valEl = document.getElementById('spynet-ip-value');
    const countryEl = document.getElementById('spynet-country');
    const flagEl = document.getElementById('spynet-flag');
    const ispEl = document.getElementById('spynet-isp');
    const latEl = document.getElementById('spynet-latency');

    if (valEl) {
      valEl.classList.remove('changing');
      void valEl.offsetWidth;
      valEl.classList.add('changing');
      valEl.textContent = ip;
    }
    if (countryEl) countryEl.textContent = entry.country;
    if (flagEl) flagEl.textContent = entry.flag;
    if (ispEl) ispEl.textContent = entry.isp;
    if (latEl) {
      latEl.textContent = latency + ' ms';
      latEl.className = 'spy-stat-val ' + (latency < 60 ? '' : latency < 140 ? 'amber' : 'red');
    }
  }

  function updateStats() {
    const rotEl = document.getElementById('spynet-rotations');
    const logEl = document.getElementById('spynet-log-count');
    const miniRot = document.getElementById('spynet-mini-rotations');
    const miniCountries = document.getElementById('spynet-mini-countries');

    if (rotEl) rotEl.textContent = totalRotations;
    if (logEl) logEl.textContent = log.length;
    if (miniRot) miniRot.textContent = totalRotations;
    const uniqueCountries = new Set(log.map(l => l.entry.country)).size;
    if (miniCountries) miniCountries.textContent = uniqueCountries;
  }

  function updateUI() {
    const btn = document.getElementById('spynet-toggle-btn');
    const statusDot = document.getElementById('spynet-status-dot');
    const statusText = document.getElementById('spynet-status-text');
    if (btn) {
      btn.textContent = isRunning ? '■ STOP ROTATION' : '▶ START ROTATION';
      btn.className = 'spy-toggle-main ' + (isRunning ? 'running' : '');
    }
    if (statusDot) statusDot.className = 'spy-dot ' + (isRunning ? '' : 'idle');
    if (statusText) statusText.textContent = isRunning ? 'ACTIVE' : 'STANDBY';
  }

  function updateTimerBar() {
    const bar = document.getElementById('spynet-timer-fill');
    const label = document.getElementById('spynet-timer-label');
    if (!bar) return;
    const pct = Math.max(0, (countdownMs / intervalMs) * 100);
    bar.style.width = pct + '%';
    if (label) label.textContent = 'Next rotation in ' + (countdownMs / 1000).toFixed(1) + 's';
  }

  function resetTimerBar() {
    const bar = document.getElementById('spynet-timer-fill');
    const label = document.getElementById('spynet-timer-label');
    if (bar) bar.style.width = '0%';
    if (label) label.textContent = 'Rotation paused';
  }

  function renderLog() {
    const body = document.getElementById('spynet-log-body');
    if (!body) return;
    body.innerHTML = log.map(l => `
      <div class="spy-log-row">
        <span class="spy-log-time">${l.ts}</span>
        <span class="spy-log-flag">${l.entry.flag}</span>
        <span class="spy-log-ip">${l.ip}</span>
        <span class="spy-log-country">${l.entry.country} · ${l.entry.isp}</span>
        <span class="spy-log-latency" style="color:${l.latency<60?'#00ff41':l.latency<140?'#ffb700':'#ff3131'}">${l.latency}ms</span>
        <span class="spy-hop">${randHops(l.ip)}</span>
      </div>`).join('');
  }

  function randHops(ip) {
    // Deterministic hop count from IP string
    const sum = ip.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return (4 + (sum % 9)) + ' hops';
  }

  // ── Route canvas animation ──────────────────────────────
  function initRouteCanvas() {
    routeCanvas = document.getElementById('spynet-route-canvas');
    if (!routeCanvas) return;
    routeCtx = routeCanvas.getContext('2d');
    resizeRouteCanvas();
    buildRouteNodes();
    animateRoute();

    const ro = new ResizeObserver(() => {
      resizeRouteCanvas();
      buildRouteNodes();
    });
    ro.observe(routeCanvas.parentElement);
  }

  function resizeRouteCanvas() {
    if (!routeCanvas || !routeCanvas.parentElement) return;
    const rect = routeCanvas.parentElement.getBoundingClientRect();
    routeCanvas.width = rect.width;
    routeCanvas.height = Math.max(rect.height - 85, 80);
  }

  function buildRouteNodes() {
    if (!routeCanvas) return;
    const W = routeCanvas.width, H = routeCanvas.height;
    const count = 6;
    routeNodes = [];
    for (let i = 0; i < count; i++) {
      routeNodes.push({
        x: 20 + (i / (count - 1)) * (W - 40),
        y: H / 2 + (i % 2 === 0 ? -H * 0.18 : H * 0.18),
        label: i === 0 ? 'YOU' : i === count - 1 ? 'TARGET' : 'HOP ' + i,
        r: i === 0 || i === count - 1 ? 7 : 4,
        isEndpoint: i === 0 || i === count - 1,
      });
    }
    routePackets = [];
  }

  function addRoutePacket() {
    if (routeNodes.length < 2) return;
    routePackets.push({ progress: 0, speed: 0.004 + Math.random() * 0.004 });
  }

  function animateRoute() {
    routeAnimFrame = requestAnimationFrame(animateRoute);
    if (!routeCtx || !routeCanvas) return;
    const W = routeCanvas.width, H = routeCanvas.height;
    routeCtx.clearRect(0, 0, W, H);

    if (routeNodes.length < 2) return;

    // Draw edges
    routeCtx.save();
    for (let i = 0; i < routeNodes.length - 1; i++) {
      const a = routeNodes[i], b = routeNodes[i + 1];
      routeCtx.beginPath();
      routeCtx.moveTo(a.x, a.y);
      routeCtx.lineTo(b.x, b.y);
      routeCtx.strokeStyle = 'rgba(0,255,65,0.12)';
      routeCtx.lineWidth = 1;
      routeCtx.stroke();
    }

    // Draw nodes
    routeNodes.forEach((n, i) => {
      routeCtx.beginPath();
      routeCtx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      routeCtx.fillStyle = n.isEndpoint ? '#00ff41' : 'rgba(0,255,65,0.5)';
      routeCtx.fill();
      if (n.isEndpoint) {
        routeCtx.beginPath();
        routeCtx.arc(n.x, n.y, n.r + 4, 0, Math.PI * 2);
        routeCtx.strokeStyle = 'rgba(0,255,65,0.25)';
        routeCtx.lineWidth = 1;
        routeCtx.stroke();
      }
      // Label
      routeCtx.fillStyle = 'rgba(0,255,65,0.55)';
      routeCtx.font = '8px monospace';
      routeCtx.textAlign = 'center';
      routeCtx.fillText(n.label, n.x, n.y + n.r + 10);
    });

    // Animate packets
    routePackets = routePackets.filter(p => p.progress <= 1);
    routePackets.forEach(p => {
      p.progress += p.speed * (isRunning ? 1.8 : 0.4);
      const totalLen = routeNodes.length - 1;
      const segIdx = Math.min(Math.floor(p.progress * totalLen), totalLen - 1);
      const segPct = (p.progress * totalLen) - segIdx;
      const a = routeNodes[segIdx], b = routeNodes[Math.min(segIdx + 1, routeNodes.length - 1)];
      const px = a.x + (b.x - a.x) * segPct;
      const py = a.y + (b.y - a.y) * segPct;

      routeCtx.beginPath();
      routeCtx.arc(px, py, 3, 0, Math.PI * 2);
      routeCtx.fillStyle = '#00ff41';
      routeCtx.shadowColor = '#00ff41';
      routeCtx.shadowBlur = 10;
      routeCtx.fill();
      routeCtx.shadowBlur = 0;
    });

    // Auto-add packets while running
    if (isRunning && Math.random() < 0.018) addRoutePacket();
    else if (!isRunning && Math.random() < 0.003) addRoutePacket();

    routeCtx.restore();
  }

  // ── Init ────────────────────────────────────────────────
  function init() {
    if (!document.getElementById('spynet-toggle-btn')) return;

    // Interval selector
    const sel = document.getElementById('spynet-interval-sel');
    if (sel) {
      sel.value = String(intervalMs / 1000);
      sel.addEventListener('change', () => {
        intervalMs = parseInt(sel.value) * 1000;
        if (isRunning) start(intervalMs);
      });
    }

    // Toggle button
    const btn = document.getElementById('spynet-toggle-btn');
    if (btn) btn.addEventListener('click', () => isRunning ? stop() : start());

    // Clear log
    const clr = document.getElementById('spynet-clear-log');
    if (clr) clr.addEventListener('click', () => { log = []; totalRotations = 0; renderLog(); updateStats(); });

    // Canvas
    initRouteCanvas();
    updateUI();
    updateStats();

    // If was running, reconnect
    if (isRunning) updateTimerBar();
  }

  function destroy() {
    if (routeAnimFrame) cancelAnimationFrame(routeAnimFrame);
    routeAnimFrame = null;
    // Don't stop rotation — let it keep running in background
  }

  return { init, start, stop, destroy, get isRunning() { return isRunning; } };
})();
