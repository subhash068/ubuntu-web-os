// System State Elements
const termInput = document.getElementById('term-input');
const termBody = document.getElementById('terminal-body');
const noteArea = document.getElementById('note-area');
const toast = document.getElementById('toast');
const connBadge = document.getElementById('conn-badge');
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');

// System Stats Elements
const cpuVal = document.getElementById('cpu-val');
const cpuBar = document.getElementById('cpu-bar');
const ramVal = document.getElementById('ram-val');
const ramBar = document.getElementById('ram-bar');
const diskVal = document.getElementById('disk-val');
const diskBar = document.getElementById('disk-bar');

// File Manager Elements
const currentDirLabel = document.getElementById('current-dir');
const fileListContainer = document.getElementById('file-list');
const editorModal = document.getElementById('editor-modal');
const modalFilename = document.getElementById('modal-filename');
const editorContent = document.getElementById('editor-content');

// Task Manager Elements
const taskListBody = document.getElementById('task-list-body');
const taskSearch = document.getElementById('task-search');

// Clock and Latency
const systemClock = document.getElementById('system-clock');
const latencyVal = document.getElementById('latency-val');

// Start Menu Elements
const startMenuTrigger = document.getElementById('start-menu-trigger');
const startMenu = document.getElementById('start-menu');
const startSearch = document.getElementById('start-search');

const BACKEND_URL = 'http://localhost:9500';

let csrfToken = '';
let isAuthed = false;

// Command history state
let commandHistory = [];
let historyIndex = -1;

// Process sorting state
let processSortKey = '';
let processSortAsc = true;

async function apiLogin() {
    const username = document.getElementById('login-username')?.value ?? '';
    const password = document.getElementById('login-password')?.value ?? '';
    showLoginError('');
    try {
        const res = await fetch(`${BACKEND_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Login failed');
        }
        const data = await res.json();
        csrfToken = data.csrf || '';
        isAuthed = true;
        hideLoginModal();
        initSystem();
    } catch (e) {
        showLoginError(e.message);
    }
}

function showLoginError(msg) {
    const el = document.getElementById('login-error');
    if (el) el.textContent = msg;
}

function showLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('open');
    }
}

function hideLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('open');
    }
}

async function apiCommand(op, args = {}) {
    if (!isAuthed) throw new Error('Not authenticated');
    const res = await fetch(`${BACKEND_URL}/api/command`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({ op, args })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = data?.error || 'Request failed';
        throw new Error(err);
    }
    return data;
}

// Best-effort dispatcher to keep existing UI calls working.
// This is intentionally strict: it only supports commands that the current UI already emits.
async function apiExecuteLegacy(command) {
    const cmd = (command || '').trim();

    if (cmd === 'whoami') return apiCommand('whoami', {});
    if (cmd === 'pwd') return apiCommand('pwd', {});
    if (cmd === 'ps aux') return apiCommand('ps_aux', {});

    if (cmd === 'bash /mnt/d/ubuntu-web-os/stats.sh') return apiCommand('stats_sh', {});

    if (cmd === 'ls') {
        return apiCommand('ls', { path: currentPath });
    }
    if (cmd.startsWith('ls ')) {
        const rest = cmd.slice(3).trim();
        if (rest.startsWith('-ap --group-directories-first')) {
            const m = cmd.match(/ls -ap --group-directories-first\s+"?([^"]+?)"?$/);
            const path = m?.[1] || '/root';
            return apiCommand('ls', { path });
        } else {
            // Support 'ls <path>' (strip potential quotes)
            const path = rest.replace(/^"|"$/g, '');
            return apiCommand('ls', { path });
        }
    }

    // cat "<path>" or cat <path>
    {
        const m = cmd.match(/^cat\s+"?([^"]+?)"?$/);
        if (m) return apiCommand('cat', { path: m[1] });
    }

    // stat -c "%A %a %U %G %s" "<path>" or stat -c "%A %a %U %G %s" <path> or other quote configurations
    {
        const m = cmd.match(/^stat\s+-c\s+"?%A %a %U %G %s"?\s+"?([^"]+?)"?$/);
        if (m) return apiCommand('stat', { path: m[1] });
    }

    // chmod XXX "<path>" or chmod XXX <path>
    {
        const m = cmd.match(/^chmod\s+(\d{3})\s+"?([^"]+?)"?$/);
        if (m) return apiCommand('chmod', { mode: m[1], path: m[2] });
    }

    // touch "<path>" or touch <path>
    {
        const m = cmd.match(/^touch\s+"?([^"]+?)"?$/);
        if (m) return apiCommand('touch', { path: m[1] });
    }

    // mkdir -p "<path>" or mkdir -p <path>
    {
        const m = cmd.match(/^mkdir\s+-p\s+"?([^"]+?)"?$/);
        if (m) return apiCommand('mkdir_p', { path: m[1] });
    }

    // kill -9 <pid> or kill <pid>
    {
        const m = cmd.match(/^kill\s+(?:-9\s+)?(\d+)$/);
        if (m) return apiCommand('kill', { pid: m[1] });
    }

    // rm -rf "<path>" or rm -f "<path>" or no quotes
    {
        const m = cmd.match(/^rm\s+(-rf|-f)\s+"?([^"]+?)"?$/);
        if (m) {
            const is_dir = m[1] === '-rf';
            return apiCommand('rm_file', { path: m[2], is_dir });
        }
    }

    // apt-cache search "<q>" | head -n 30 or apt-cache search <q>
    {
        const m = cmd.match(/^apt-cache search\s+"?([^"]+?)"?(?:\s*\|\s*head -n 30)?$/);
        if (m) return apiCommand('apt_cache_search', { query: m[1] });
    }

    // apt-get install / apt install variants
    {
        const m = cmd.match(/^(?:DEBIAN_FRONTEND=noninteractive\s+)?(?:apt-get|apt)\s+(?:install\s+-y|install)\s+"?([^"]+?)"?$/);
        if (m) return apiCommand('apt_get_install', { pkg: m[1] });
    }

    // Network diagnostics: ping/nslookup/nmap patterns
    {
        const m = cmd.match(/^(?:ping\s+-c\s+4\s+|ping\s+)"?([^"]+?)"?$/);
        if (m) return apiCommand('net_tool', { tool: 'ping', host: m[1] });
    }
    {
        const m = cmd.match(/^nslookup\s+"?([^"]+?)"?$/);
        if (m) return apiCommand('net_tool', { tool: 'nslookup', host: m[1] });
    }
    {
        const m = cmd.match(/^(?:nmap\s+-F\s+|nmap\s+)"?([^"]+?)"?$/);
        if (m) return apiCommand('net_tool', { tool: 'nmap', host: m[1] });
    }

    throw new Error('Command not supported by secure dispatcher');
}

async function ensureAuthed() {
    if (isAuthed) return;
    showLoginModal();
    throw new Error('Login required');
}

let currentPath = '/root';
let currentlyEditingFile = '';
let runningProcesses = []; // Cached processes for fast local filtering

// ================= Window Manager State & Logic =================
const windows = {
    terminal: { active: true, min: false, max: false, x: 80, y: 80, w: 620, h: 420, icon: 'fa-terminal', name: 'Terminal' },
    files: { active: false, min: false, max: false, x: 450, y: 100, w: 550, h: 420, icon: 'fa-folder-open', name: 'Files' },
    monitor: { active: false, min: false, max: false, x: 150, y: 250, w: 480, h: 350, icon: 'fa-chart-line', name: 'Monitor' },
    tasks: { active: false, min: false, max: false, x: 300, y: 180, w: 680, h: 450, icon: 'fa-list-check', name: 'Tasks' },
    notes: { active: false, min: false, max: false, x: 800, y: 120, w: 450, h: 350, icon: 'fa-pen-to-square', name: 'Notepad' },
    settings: { active: false, min: false, max: false, x: 550, y: 200, w: 450, h: 380, icon: 'fa-gears', name: 'Settings' },
    store: { active: false, min: false, max: false, x: 350, y: 150, w: 640, h: 450, icon: 'fa-shop', name: 'App Store' },
    network: { active: false, min: false, max: false, x: 250, y: 220, w: 620, h: 420, icon: 'fa-network-wired', name: 'Network' },
    cleaner: { active: false, min: false, max: false, x: 600, y: 240, w: 460, h: 380, icon: 'fa-broom', name: 'Cleaner' },
    deploy: { active: false, min: false, max: false, x: 200, y: 150, w: 660, h: 480, icon: 'fa-server', name: 'Deploy Center' },
    browser: { active: false, min: false, max: false, x: 120, y: 120, w: 700, h: 500, icon: 'fa-globe', name: 'Browser' }
};

let highestZ = 100;
let activeDrag = null;
let dragStartX = 0, dragStartY = 0;
let resizeStartW = 0, resizeStartH = 0;

// Focus window depth (bring to front)
function focusWindow(winId) {
    const win = windows[winId];
    if (!win || !win.active) return;
    
    highestZ++;
    const winEl = document.getElementById(`win-${winId}`);
    winEl.style.zIndex = highestZ;
    
    document.querySelectorAll('.window').forEach(el => el.classList.remove('active-focus'));
    winEl.classList.add('active-focus');
    
    updateTaskbarBadges();
}

// Open window (launch or restore)
function openWindow(winId) {
    const win = windows[winId];
    const winEl = document.getElementById(`win-${winId}`);
    
    win.active = true;
    win.min = false;
    winEl.style.display = 'flex';
    winEl.classList.remove('minimized');
    
    focusWindow(winId);

    if (winId === 'tasks') {
        refreshProcesses();
    } else if (winId === 'deploy') {
        refreshDeployOverview();
    } else if (winId === 'browser') {
        initBrowserIframe();
    }
}

// Minimize window
function minimizeWindow(winId) {
    const win = windows[winId];
    const winEl = document.getElementById(`win-${winId}`);
    
    win.min = true;
    winEl.classList.add('minimized');
    updateTaskbarBadges();
}

// Toggle Maximize window
function toggleMaximize(winId) {
    const win = windows[winId];
    const winEl = document.getElementById(`win-${winId}`);
    
    win.max = !win.max;
    if (win.max) {
        winEl.classList.add('maximized');
    } else {
        winEl.classList.remove('maximized');
    }
}

// Close window
function closeWindow(winId) {
    const win = windows[winId];
    const winEl = document.getElementById(`win-${winId}`);
    
    win.active = false;
    winEl.style.display = 'none';
    updateTaskbarBadges();
}

// Drag functionality
function startDrag(e, winId) {
    focusWindow(winId);
    if (windows[winId].max) return;
    if (e.target.closest('.win-btn')) return;

    const winEl = document.getElementById(`win-${winId}`);
    activeDrag = { id: winId, type: 'drag' };
    dragStartX = e.clientX - winEl.offsetLeft;
    dragStartY = e.clientY - winEl.offsetTop;
    
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
}

function handleDragMove(e) {
    if (!activeDrag || activeDrag.type !== 'drag') return;
    const winEl = document.getElementById(`win-${activeDrag.id}`);
    
    const x = e.clientX - dragStartX;
    const y = e.clientY - dragStartY;
    
    winEl.style.left = `${x}px`;
    winEl.style.top = `${y}px`;
    
    windows[activeDrag.id].x = x;
    windows[activeDrag.id].y = y;
}

// Resize functionality
function startResize(e, winId) {
    focusWindow(winId);
    if (windows[winId].max) return;
    
    const winEl = document.getElementById(`win-${winId}`);
    activeDrag = { id: winId, type: 'resize' };
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    resizeStartW = winEl.clientWidth;
    resizeStartH = winEl.clientHeight;
    
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleDragEnd);
    e.preventDefault();
}

function handleResizeMove(e) {
    if (!activeDrag || activeDrag.type !== 'resize') return;
    const winEl = document.getElementById(`win-${activeDrag.id}`);
    
    const w = resizeStartW + (e.clientX - dragStartX);
    const h = resizeStartH + (e.clientY - dragStartY);
    
    const finalW = Math.max(w, 280);
    const finalH = Math.max(h, 200);
    
    winEl.style.width = `${finalW}px`;
    winEl.style.height = `${finalH}px`;
    
    windows[activeDrag.id].w = finalW;
    windows[activeDrag.id].h = finalH;
}

function handleDragEnd() {
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleDragEnd);
    activeDrag = null;
}

// Taskbar Indicators
function updateTaskbarBadges() {
    const taskbarContainer = document.getElementById('taskbar-apps');
    taskbarContainer.innerHTML = '';
    
    Object.keys(windows).forEach(winId => {
        const win = windows[winId];
        if (win.active) {
            const badge = document.createElement('div');
            const isActiveFocus = document.getElementById(`win-${winId}`).classList.contains('active-focus');
            
            badge.className = `app-badge ${isActiveFocus && !win.min ? 'active' : ''}`;
            badge.innerHTML = `<i class="fa-solid ${win.icon}"></i> <span>${win.name}</span>`;
            
            badge.onclick = () => {
                if (win.min) {
                    openWindow(winId);
                } else if (isActiveFocus) {
                    minimizeWindow(winId);
                } else {
                    focusWindow(winId);
                }
            };
            
            taskbarContainer.appendChild(badge);
        }
    });
}

// System clock
function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    systemClock.textContent = `${hours}:${minutes} ${ampm}`;
}

// Start Menu logic
startMenuTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    startMenu.classList.toggle('open');
});

document.addEventListener('click', (e) => {
    if (!startMenu.contains(e.target) && e.target !== startMenuTrigger) {
        startMenu.classList.remove('open');
    }
});

startSearch.addEventListener('input', () => {
    const query = startSearch.value.toLowerCase();
    const appItems = document.querySelectorAll('.start-app-item');
    
    appItems.forEach(item => {
        const text = item.querySelector('span').textContent.toLowerCase();
        if (text.includes(query)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
});

function launchFromStart(winId) {
    openWindow(winId);
    startMenu.classList.remove('open');
    startSearch.value = '';
    document.querySelectorAll('.start-app-item').forEach(el => el.style.display = 'flex');
}

// Settings Wallpaper Config
function setWallpaper(theme) {
    const body = document.getElementById('desktop-body');
    if (theme === 'aurora') {
        body.style.background = 'linear-gradient(135deg, #111827, #5b21b6, #e11d48)';
    } else if (theme === 'midnight') {
        body.style.background = 'linear-gradient(135deg, #09090b, #18181b, #27272a)';
    } else if (theme === 'ubuntu') {
        body.style.background = 'linear-gradient(135deg, #5e2750, #77216f, #e95420)';
    } else if (theme === 'cyberpunk') {
        body.style.background = 'linear-gradient(135deg, #0f172a, #0369a1, #0d9488)';
    }
    showToast('Wallpaper updated!');
}

function applyCustomWallpaper() {
    const urlInput = document.getElementById('custom-wall-url');
    const url = urlInput.value.trim();
    if (url) {
        document.getElementById('desktop-body').style.background = `url('${url}') center/cover no-repeat`;
        showToast('Custom wallpaper applied!');
    }
}

// Set up click listener on windows to trigger focus z-index change
function setupWindowClickFocus() {
    Object.keys(windows).forEach(winId => {
        const el = document.getElementById(`win-${winId}`);
        el.addEventListener('mousedown', () => focusWindow(winId));
    });
}

// ================= Task Manager Logic =================
async function refreshProcesses() {
    taskListBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">Loading running tasks...</td></tr>';
    
    try {
        const data = await apiExecuteLegacy('ps aux');
        if (data.stderr) {
            taskListBody.innerHTML = `<tr><td colspan="6" style="color: #ef4444; padding: 1rem;">Error: ${data.stderr}</td></tr>`;
            return;
        }
        
        const lines = (data.stdout || '').trim().split('\n');
        runningProcesses = [];
            
            // Skip the first header line of ps aux
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const tokens = line.split(/\s+/);
                if (tokens.length >= 11) {
                    const cmd = tokens.slice(10).join(' ');
                    runningProcesses.push({
                        user: tokens[0],
                        pid: tokens[1],
                        cpu: tokens[2],
                        mem: tokens[3],
                        command: cmd
                    });
                }
            }
            
        renderProcesses();
    } catch (e) {
        taskListBody.innerHTML = '<tr><td colspan="6" style="color: #ef4444; text-align: center; padding: 1rem;">Connection Error</td></tr>';
    }
}

function renderProcesses() {
    const query = taskSearch.value.toLowerCase().trim();
    taskListBody.innerHTML = '';
    
    let filtered = runningProcesses.filter(p => {
        return p.command.toLowerCase().includes(query) || 
               p.user.toLowerCase().includes(query) || 
               p.pid.includes(query);
    });
    
    if (processSortKey) {
        filtered.sort((a, b) => {
            let valA = a[processSortKey];
            let valB = b[processSortKey];
            
            if (['pid', 'cpu', 'mem'].includes(processSortKey)) {
                valA = parseFloat(valA);
                valB = parseFloat(valB);
            } else {
                valA = String(valA).toLowerCase();
                valB = String(valB).toLowerCase();
            }
            
            if (valA < valB) return processSortAsc ? -1 : 1;
            if (valA > valB) return processSortAsc ? 1 : -1;
            return 0;
        });
    }
    
    if (filtered.length === 0) {
        taskListBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No matching tasks found</td></tr>';
        return;
    }
    
    filtered.forEach(p => {
        const tr = document.createElement('tr');
        
        const isShortCmd = p.command.length > 50;
        const displayCmd = isShortCmd ? p.command.substring(0, 47) + '...' : p.command;
        
        tr.innerHTML = `
            <td style="padding: 0.5rem 0.8rem; color: #fff; font-weight: 500;">${p.user}</td>
            <td style="padding: 0.5rem 0.8rem; color: var(--text-secondary);">${p.pid}</td>
            <td style="padding: 0.5rem 0.8rem; color: #10b981;">${p.cpu}%</td>
            <td style="padding: 0.5rem 0.8rem; color: #38bdf8;">${p.mem}%</td>
            <td style="padding: 0.5rem 0.8rem;" class="task-cmd-cell" title="${p.command}">${displayCmd}</td>
            <td style="padding: 0.5rem 0.8rem; text-align: right;">
                <button class="fm-btn" style="background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3); color: #ef4444; padding: 0.2rem 0.5rem;" onclick="killProcess('${p.pid}', '${p.command}')">End Task</button>
            </td>
        `;
        taskListBody.appendChild(tr);
    });
}

function sortProcesses(key) {
    if (processSortKey === key) {
        processSortAsc = !processSortAsc;
    } else {
        processSortKey = key;
        processSortAsc = true;
    }
    
    const keys = ['user', 'pid', 'cpu', 'mem', 'command'];
    keys.forEach(k => {
        const el = document.getElementById(`sort-${k}`);
        if (el) {
            if (k === processSortKey) {
                el.innerHTML = processSortAsc ? ' ▲' : ' ▼';
                el.style.opacity = '1';
            } else {
                el.innerHTML = '';
                el.style.opacity = '0.3';
            }
        }
    });
    
    renderProcesses();
}

// Local search filtering
taskSearch.addEventListener('input', renderProcesses);

async function killProcess(pid, command) {
    const shortName = command.split(' ')[0].split('/').pop();
    if (!confirm(`Are you sure you want to terminate process ${pid} (${shortName})?`)) return;

    try {
        const data = await apiExecuteLegacy(`kill -9 ${pid}`);
        if (data && data.exit_code === 0) {
            showToast(`Terminated task ${pid}`);
            refreshProcesses();
        } else {
            // If stderr exists, show it
            const err = data?.stderr || 'Failed to kill process';
            alert(err);
        }
    } catch (e) {
        alert(`Failed to kill process: ${e.message}`);
    }
}

// ================= Ubuntu Connection & Console Logic =================
async function initSystem() {
    updateClock();
    setInterval(updateClock, 1000);
    setupWindowClickFocus();
    updateTaskbarBadges();
    
    document.getElementById('win-settings').style.display = 'none';
    document.getElementById('win-tasks').style.display = 'none';
    document.getElementById('win-cleaner').style.display = 'none';
    
    try {
        const connected = await testConnection();
        if (connected) {
            updateConnectionStatus(true);
            printOutput('Ubuntu 24.04 remote console session established successfully.\nReady for commands.', 'system-msg');
            
            await determineHomeDir();
            
            fetchSystemStats();
            setInterval(fetchSystemStats, 4000);
            
            refreshFiles();
        } else {
            updateConnectionStatus(false);
        }
    } catch (e) {
        updateConnectionStatus(false);
    }
}

async function testConnection() {
    try {
        await apiExecuteLegacy('whoami');
        return true;
    } catch (e) {
        return false;
    }
}

async function determineHomeDir() {
    try {
        const data = await apiExecuteLegacy('pwd');
        if (data.stdout) {
            currentPath = data.stdout.trim();
            updatePrompt();
        }
    } catch (e) {}
}

function updateConnectionStatus(isConnected) {
    if (isConnected) {
        connBadge.style.background = 'rgba(16, 185, 129, 0.1)';
        connBadge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
        connBadge.style.color = '#10b981';
        connDot.style.backgroundColor = '#10b981';
        connDot.style.boxShadow = '0 0 8px #10b981';
        connText.textContent = 'Active WSL Link';
    } else {
        connBadge.style.background = 'rgba(239, 68, 68, 0.1)';
        connBadge.style.borderColor = 'rgba(239, 68, 68, 0.2)';
        connBadge.style.color = '#ef4444';
        connDot.style.backgroundColor = '#ef4444';
        connDot.style.boxShadow = '0 0 8px #ef4444';
        connText.textContent = 'Offline (Server stopped)';
    }
}

async function fetchSystemStats() {
    const startTime = performance.now();
    try {
        const data = await apiCommand('stats_sh', {});
        const endTime = performance.now();
        const latency = Math.round(endTime - startTime);
        latencyVal.textContent = `Ping: ${latency} ms`;

        const output = data?.stdout || '';
        if (output && output.includes('---STATS---')) {
            const parts = output.split('---STATS---')[1].trim().split('\n');
            if (parts.length >= 3) {
                const cpu = parseFloat(parts[0]).toFixed(1);
                const [ramUsed, ramTotal] = parts[1].split(' ');
                const [diskUsed, diskTotal, diskPctStr] = parts[2].trim().split(/\s+/);
                const diskPct = parseInt(diskPctStr.replace('%', ''));

                cpuVal.textContent = `${cpu}%`;
                cpuBar.style.width = `${cpu}%`;

                ramVal.textContent = `${ramUsed} / ${ramTotal} MB`;
                const ramPct = ((parseInt(ramUsed) / parseInt(ramTotal)) * 100).toFixed(1);
                ramBar.style.width = `${ramPct}%`;

                diskVal.textContent = `${diskUsed} / ${diskTotal} (${diskPctStr})`;
                diskBar.style.width = `${diskPct}%`;

                updateConnectionStatus(true);
            }
        }
    } catch (e) {
        updateConnectionStatus(false);
    }
}

// ================= File Manager Logic =================
function updatePrompt() {
    const promptLabel = document.getElementById('prompt-label');
    if (promptLabel) {
        promptLabel.textContent = `root@ubuntu:${currentPath}$`;
    }
}

async function refreshFiles() {
    currentDirLabel.textContent = currentPath;
    updatePrompt();
    fileListContainer.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 2rem;">Loading files...</div>';
    
    try {
        const data = await apiExecuteLegacy(`ls -ap --group-directories-first "${currentPath}"`);
        if (data.stderr) {
            fileListContainer.innerHTML = `<div style="color: #ef4444; padding: 1rem;">Error: ${data.stderr}</div>`;
            return;
        }
        
        const lines = (data.stdout || '').trim().split('\n').filter(line => line.trim() && line !== './' && line !== '../');
        
        if (lines.length === 0) {
            fileListContainer.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 2rem;">Empty folder</div>';
            return;
        }

        fileListContainer.innerHTML = '';
        
        lines.forEach(item => {
            const isDir = item.endsWith('/');
            const cleanName = isDir ? item.slice(0, -1) : item;
                
            const row = document.createElement('div');
            row.className = 'file-row';
                
                const iconDiv = document.createElement('div');
                iconDiv.className = `file-icon ${isDir ? 'folder' : 'file'}`;
                iconDiv.innerHTML = isDir ? '<i class="fa-solid fa-folder"></i>' : '<i class="fa-solid fa-file"></i>';
                row.appendChild(iconDiv);
                
                const nameDiv = document.createElement('div');
                nameDiv.className = 'file-name';
                nameDiv.textContent = cleanName;
                row.appendChild(nameDiv);
                
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'file-actions';
                
                if (!isDir) {
                    const editBtn = document.createElement('button');
                    editBtn.className = 'file-row-btn';
                    editBtn.innerHTML = '<i class="fa-solid fa-pen-to-square" title="Edit"></i>';
                    editBtn.onclick = (e) => {
                        e.stopPropagation();
                        openFile(cleanName);
                    };
                    actionsDiv.appendChild(editBtn);

                    const downloadBtn = document.createElement('button');
                    downloadBtn.className = 'file-row-btn';
                    downloadBtn.innerHTML = '<i class="fa-solid fa-download" title="Download"></i>';
                    downloadBtn.onclick = (e) => {
                        e.stopPropagation();
                        downloadFile(cleanName);
                    };
                    actionsDiv.appendChild(downloadBtn);
                }
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'file-row-btn btn-delete';
                deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can" title="Delete"></i>';
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteItem(cleanName, isDir);
                };
                actionsDiv.appendChild(deleteBtn);

                const propBtn = document.createElement('button');
                propBtn.className = 'file-row-btn';
                propBtn.innerHTML = '<i class="fa-solid fa-circle-info" title="Properties"></i>';
                propBtn.onclick = (e) => {
                    e.stopPropagation();
                    openProperties(cleanName, isDir);
                };
                actionsDiv.appendChild(propBtn);

                row.appendChild(actionsDiv);
                
                row.onclick = () => {
                    if (isDir) {
                        if (currentPath === '/') {
                            currentPath = '/' + cleanName;
                        } else {
                            currentPath = currentPath.replace(/\/$/, '') + '/' + cleanName;
                        }
                        refreshFiles();
                    } else {
                        openFile(cleanName);
                    }
                };

                row.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showContextMenu(e, cleanName, isDir);
                };

                fileListContainer.appendChild(row);
            });
    } catch (e) {
        fileListContainer.innerHTML = `<div style="color: #ef4444; padding: 1rem;">Connection Error</div>`;
    }
}

function navigateUp() {
    if (currentPath === '/' || currentPath === '') return;
    const parts = currentPath.split('/');
    parts.pop();
    currentPath = parts.join('/') || '/';
    refreshFiles();
}

let openTabs = []; // list of { path: string, filename: string, model: any, isDirty: boolean }
let activeTabPath = '';
let editorInstance = null;
let monacoLoaded = false;
let monacoLoading = false;
let monacoCallbacks = [];

function initMonaco(callback) {
    if (monacoLoaded) {
        if (callback) callback();
        return;
    }
    
    if (callback) monacoCallbacks.push(callback);
    
    if (monacoLoading) return;
    monacoLoading = true;
    
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function () {
        monacoLoaded = true;
        monacoLoading = false;
        
        monaco.editor.defineTheme('ubuntu-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
                { token: 'keyword', foreground: 'ff7e5f', fontStyle: 'bold' },
                { token: 'string', foreground: '4ade80' },
                { token: 'number', foreground: '38bdf8' }
            ],
            colors: {
                'editor.background': '#040508',
                'editor.foreground': '#f3f4f6',
                'editor.lineHighlightBackground': '#11131e',
                'editorCursor.foreground': '#E95420',
                'editor.selectionBackground': '#77216F55',
                'editorWidget.background': '#0c0d15',
                'editorWidget.border': '#27272a'
            }
        });
        
        editorInstance = monaco.editor.create(document.getElementById('monaco-editor-container'), {
            theme: 'ubuntu-dark',
            automaticLayout: true,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
            minimap: { enabled: false },
            padding: { top: 10, bottom: 10 }
        });
        
        monacoCallbacks.forEach(cb => cb());
        monacoCallbacks = [];
    });
}

function getLanguageFromFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    switch (ext) {
        case 'js': return 'javascript';
        case 'ts': return 'typescript';
        case 'html': return 'html';
        case 'css': return 'css';
        case 'json': return 'json';
        case 'py': return 'python';
        case 'sh':
        case 'bash':
            return 'shellscript';
        case 'md': return 'markdown';
        default: return 'plaintext';
    }
}

async function openFile(filename) {
    const filePath = currentPath.replace(/\/$/, '') + '/' + filename;
    
    initMonaco(async () => {
        editorModal.classList.add('open');
        
        const existingTab = openTabs.find(t => t.path === filePath);
        if (existingTab) {
            switchTab(filePath);
            return;
        }
        
        document.getElementById('editor-status').textContent = `Loading ${filename}...`;
        
        try {
            const data = await apiExecuteLegacy(`cat "${filePath}"`);
            if (data) {
                const content = data.stdout || '';
                
                const language = getLanguageFromFilename(filename);
                const model = monaco.editor.createModel(content, language);
                
                const newTab = {
                    path: filePath,
                    filename: filename,
                    model: model,
                    isDirty: false
                };
                
                model.onDidChangeContent(() => {
                    if (!newTab.isDirty) {
                        newTab.isDirty = true;
                        document.getElementById('editor-status').textContent = 'Unsaved changes...';
                        renderTabs();
                    }
                });
                
                openTabs.push(newTab);
                switchTab(filePath);
            } else {
                document.getElementById('editor-status').textContent = 'Error opening file.';
            }
        } catch (e) {
            document.getElementById('editor-status').textContent = `Error: ${e.message}`;
        }
    });
}

function switchTab(path) {
    const tab = openTabs.find(t => t.path === path);
    if (!tab) return;
    
    activeTabPath = path;
    editorInstance.setModel(tab.model);
    renderTabs();
    
    if (tab.isDirty) {
        document.getElementById('editor-status').textContent = 'Unsaved changes...';
    } else {
        document.getElementById('editor-status').textContent = 'All files saved';
    }
}

function renderTabs() {
    const tabsContainer = document.getElementById('editor-tabs');
    tabsContainer.innerHTML = '';
    
    openTabs.forEach(tab => {
        const div = document.createElement('div');
        div.className = `editor-tab ${tab.path === activeTabPath ? 'active' : ''}`;
        div.onclick = () => switchTab(tab.path);
        
        const dirtyDot = tab.isDirty ? '<span class="editor-tab-dirty-dot"></span> ' : '';
        
        div.innerHTML = `
            ${dirtyDot}
            <span>${tab.filename}</span>
            <i class="fa-solid fa-xmark editor-tab-close" onclick="closeTab('${tab.path}', event)"></i>
        `;
        
        tabsContainer.appendChild(div);
    });
}

async function closeTab(path, event) {
    if (event) event.stopPropagation();
    
    const tabIndex = openTabs.findIndex(t => t.path === path);
    if (tabIndex === -1) return;
    
    const tab = openTabs[tabIndex];
    if (tab.isDirty) {
        const save = confirm(`"${tab.filename}" has unsaved changes. Save before closing?`);
        if (save) {
            await saveTab(path);
        }
    }
    
    tab.model.dispose();
    openTabs.splice(tabIndex, 1);
    
    if (openTabs.length === 0) {
        closeEditor();
    } else {
        if (activeTabPath === path) {
            const nextActiveIndex = Math.max(0, tabIndex - 1);
            switchTab(openTabs[nextActiveIndex].path);
        } else {
            renderTabs();
        }
    }
}

function closeEditor() {
    editorModal.classList.remove('open');
    openTabs.forEach(t => t.model.dispose());
    openTabs = [];
    activeTabPath = '';
}

async function saveActiveTab() {
    if (!activeTabPath) return;
    await saveTab(activeTabPath);
}

async function saveTab(path) {
    const tab = openTabs.find(t => t.path === path);
    if (!tab) return;
    
    const content = tab.model.getValue();
    const base64Content = btoa(unescape(encodeURIComponent(content)));
    document.getElementById('editor-status').textContent = `Saving ${tab.filename}...`;
    
    try {
        await apiCommand('write_file_base64', { path, b64: base64Content });
        tab.isDirty = false;
        document.getElementById('editor-status').textContent = 'All files saved';
        showToast(`Saved ${tab.filename}`);
        renderTabs();
        refreshFiles();
    } catch (e) {
        document.getElementById('editor-status').textContent = `Error: ${e.message}`;
    }
}

// Auto-Save interval every 5 seconds
setInterval(async () => {
    for (const tab of openTabs) {
        if (tab.isDirty) {
            await saveTab(tab.path);
        }
    }
}, 5000);

async function deleteItem(name, isDir) {
    if (false && !confirm(`Are you sure you want to delete "${name}"?`)) return;
    
    const targetPath = currentPath.replace(/\/$/, '') + '/' + name;
    const cmd = isDir ? `rm -rf "${targetPath}"` : `rm -f "${targetPath}"`;
    
    try {
        const data = await apiExecuteLegacy(cmd);
        if (data && !data.stderr) {
            showToast('Deleted successfully!');
            refreshFiles();
        } else if (data && data.stderr) {
            alert(`Delete failed: ${data.stderr}`);
        }
    } catch (e) {
        alert(`Delete failed: ${e.message}`);
    }
}

async function promptCreateFile() {
    const name = prompt('Enter name for the new file:');
    if (!name) return;
    const targetPath = currentPath.replace(/\/$/, '') + '/' + name;
    
    try {
        const data = await apiExecuteLegacy(`touch "${targetPath}"`);
        if (data && !data.stderr) {
            showToast('File created!');
            refreshFiles();
            openFile(name);
        } else if (data && data.stderr) {
            alert(`Create file failed: ${data.stderr}`);
        }
    } catch (e) {}
}

async function promptCreateFolder() {
    const name = prompt('Enter name for the new folder:');
    if (!name) return;
    const targetPath = currentPath.replace(/\/$/, '') + '/' + name;
    
    try {
        const data = await apiExecuteLegacy(`mkdir -p "${targetPath}"`);
        if (data && !data.stderr) {
            showToast('Folder created!');
            refreshFiles();
        } else if (data && data.stderr) {
            alert(`Create folder failed: ${data.stderr}`);
        }
    } catch (e) {}
}

// ================= Terminal Logic =================
termInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const command = termInput.value.trim();
        if (command) {
            commandHistory.push(command);
            historyIndex = commandHistory.length;
            sendTerminalCommand(command);
        }
        termInput.value = '';
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commandHistory.length > 0 && historyIndex > 0) {
            historyIndex--;
            termInput.value = commandHistory[historyIndex];
        }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
            historyIndex++;
            termInput.value = commandHistory[historyIndex];
        } else {
            historyIndex = commandHistory.length;
            termInput.value = '';
        }
    }
});

async function sendTerminalCommand(command) {
    if (command.toLowerCase() === 'clear') {
        termBody.innerHTML = '';
        return;
    }

    printOutput(`<span class="prompt">root@ubuntu-24.04:~$</span> ${command}`);

    try {
        const data = await apiCommand('run_raw', { command });
        if (data && data.stdout) {
            printOutput(data.stdout);
            if (data.truncated_stdout) {
                printOutput('[Output truncated due to size limit]', 'system-msg');
            }
        }
        if (data && data.stderr) {
            printOutput(data.stderr, 'stderr-msg');
            if (data.truncated_stderr) {
                printOutput('[Error output truncated due to size limit]', 'stderr-msg');
            }
        }
        if (data && !data.stdout && !data.stderr) {
            printOutput('[Command executed with no output]', 'system-msg');
        }
        refreshFiles();
    } catch (e) {
        printOutput(`Error: ${e.message}`, 'stderr-msg');
    }
}

function printOutput(text, className = '') {
    const div = document.createElement('div');
    if (className) {
        div.className = className;
    }
    
    if (className === 'stderr-msg') {
        div.style.color = '#ef4444';
    } else if (className === 'system-msg') {
        div.style.color = '#a78bfa';
    }

    div.innerHTML = text.replace(/\n/g, '<br>');
    termBody.appendChild(div);
    termBody.scrollTop = termBody.scrollHeight;
}

// Notes Logic
function saveNotes() {
    localStorage.setItem('ubuntu_os_notes', noteArea.value);
    showToast('Notes saved!');
}

function showToast(message = 'Saved successfully!') {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
}

// Context Menu State
let currentContextMenuFile = '';
let currentContextMenuIsDir = false;

function showContextMenu(e, filename, isDir) {
    currentContextMenuFile = filename;
    currentContextMenuIsDir = isDir;

    const menu = document.getElementById('fm-context-menu');
    if (!menu) return;
    
    menu.style.display = 'flex';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    // Toggle options based on file type
    const openItem = document.getElementById('ctx-open');
    const downloadItem = document.getElementById('ctx-download');
    const compressItem = document.getElementById('ctx-compress');
    
    if (isDir) {
        if (openItem) openItem.style.display = 'none';
        if (downloadItem) downloadItem.style.display = 'none';
        if (compressItem) compressItem.textContent = 'Compress folder (.tar.gz)';
    } else {
        if (openItem) openItem.style.display = 'flex';
        if (downloadItem) downloadItem.style.display = 'flex';
        if (compressItem) compressItem.textContent = 'Compress file (.tar.gz)';
    }
}

function hideContextMenu() {
    const fmMenu = document.getElementById('fm-context-menu');
    if (fmMenu) fmMenu.style.display = 'none';
    const deskMenu = document.getElementById('desktop-context-menu');
    if (deskMenu) deskMenu.style.display = 'none';
    const shortMenu = document.getElementById('shortcut-context-menu');
    if (shortMenu) shortMenu.style.display = 'none';
}

// Launch system
window.onload = () => {
    const savedNotes = localStorage.getItem('ubuntu_os_notes');
    if (savedNotes) {
        noteArea.value = savedNotes;
    }
    
    // Hide store window initially
    document.getElementById('win-store').style.display = 'none';

    // Initialize draggable desktop shortcuts
    initDraggableShortcuts();

    // Close context menu on left click anywhere
    document.addEventListener('click', hideContextMenu);
    
    // Desktop right-click context menu handler
    const desktop = document.getElementById('desktop');
    if (desktop) {
        desktop.addEventListener('contextmenu', (e) => {
            // Ignore if right-clicked on an open window or a file manager row
            if (e.target.closest('.window') || e.target.closest('.file-row')) return;
            
            e.preventDefault();
            e.stopPropagation();
            hideContextMenu();
            
            // Check if right-clicked on a desktop shortcut
            const shortcutEl = e.target.closest('.shortcut');
            if (shortcutEl) {
                const dblclickAttr = shortcutEl.getAttribute('ondblclick') || '';
                const m = dblclickAttr.match(/openWindow\('([^']+)'\)/);
                const winId = m ? m[1] : '';
                
                const shortMenu = document.getElementById('shortcut-context-menu');
                if (shortMenu && winId) {
                    shortMenu.style.display = 'flex';
                    shortMenu.style.left = `${e.clientX}px`;
                    shortMenu.style.top = `${e.clientY}px`;
                    
                    document.getElementById('shortcut-ctx-open').onclick = () => openWindow(winId);
                    document.getElementById('shortcut-ctx-about').onclick = () => {
                        const winData = windows[winId];
                        alert(`Application: ${winData?.name || winId}\nDescription: Ubuntu 24.04 Web OS Native Tool`);
                    };
                }
            } else {
                // Right clicked on empty desktop canvas area
                const deskMenu = document.getElementById('desktop-context-menu');
                if (deskMenu) {
                    deskMenu.style.display = 'flex';
                    deskMenu.style.left = `${e.clientX}px`;
                    deskMenu.style.top = `${e.clientY}px`;
                }
            }
        });
    }

    // Dismiss custom context menus on global contextmenu events elsewhere
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('.file-row') && !e.target.closest('.shortcut') && e.target !== desktop) {
            hideContextMenu();
        }
    });

    // Bind Context Menu Action clicks
    const ctxOpen = document.getElementById('ctx-open');
    if (ctxOpen) {
        ctxOpen.onclick = () => {
            if (currentContextMenuFile) openFile(currentContextMenuFile);
        };
    }
    const ctxDownload = document.getElementById('ctx-download');
    if (ctxDownload) {
        ctxDownload.onclick = () => {
            if (currentContextMenuFile) downloadFile(currentContextMenuFile);
        };
    }
    const ctxRename = document.getElementById('ctx-rename');
    if (ctxRename) {
        ctxRename.onclick = async () => {
            if (!currentContextMenuFile) return;
            const newName = prompt(`Enter new name/path for "${currentContextMenuFile}":`, currentContextMenuFile);
            if (!newName || newName.trim() === '' || newName === currentContextMenuFile) return;

            const srcPath = currentPath.replace(/\/$/, '') + '/' + currentContextMenuFile;
            const destPath = currentPath.replace(/\/$/, '') + '/' + newName.trim();

            showToast(`Renaming/moving ${currentContextMenuFile}...`);
            try {
                const res = await apiCommand('mv', { src: srcPath, dest: destPath });
                if (res && res.exit_code === 0) {
                    showToast('Renamed successfully!');
                    refreshFiles();
                } else {
                    alert('Rename failed: ' + (res?.stderr || 'Unknown error'));
                }
            } catch (err) {
                alert('Rename failed: ' + err.message);
            }
        };
    }
    const ctxCompress = document.getElementById('ctx-compress');
    if (ctxCompress) {
        ctxCompress.onclick = async () => {
            if (!currentContextMenuFile) return;
            const targetPath = currentPath.replace(/\/$/, '') + '/' + currentContextMenuFile;
            showToast(`Compressing ${currentContextMenuFile}...`);
            try {
                const res = await apiCommand('compress', { path: targetPath });
                if (res && res.exit_code === 0) {
                    showToast('Compressed successfully!');
                    refreshFiles();
                } else {
                    alert('Compression failed: ' + (res?.stderr || 'Unknown error'));
                }
            } catch (err) {
                alert('Compression failed: ' + err.message);
            }
        };
    }
    const ctxProperties = document.getElementById('ctx-properties');
    if (ctxProperties) {
        ctxProperties.onclick = () => {
            if (currentContextMenuFile) openProperties(currentContextMenuFile, currentContextMenuIsDir);
        };
    }
    const ctxDelete = document.getElementById('ctx-delete');
    if (ctxDelete) {
        ctxDelete.onclick = () => {
            if (currentContextMenuFile) deleteItem(currentContextMenuFile, currentContextMenuIsDir);
        };
    }

    // Listen for Enter key on login inputs
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const loginBtn = document.querySelector('#login-modal button');
    
    const handleEnter = (e) => {
        if (e.key === 'Enter') {
            apiLogin();
        }
    };
    if (usernameInput) usernameInput.addEventListener('keydown', handleEnter);
    if (passwordInput) passwordInput.addEventListener('keydown', handleEnter);

    // Show login modal to gate application load
    showLoginModal();
};

// ================= App Store / Package Manager Logic =================
const storeList = document.getElementById('store-list');
const storeSearch = document.getElementById('store-search');
const installProgressContainer = document.getElementById('install-progress-container');
const installProgressBar = document.getElementById('install-progress-bar');
const installStatusText = document.getElementById('install-status-text');
const installPct = document.getElementById('install-pct');

async function searchPackages() {
    const query = storeSearch.value.trim();
    if (!query) return;
    
    storeList.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 2rem;">Searching package database...</div>';
    
    try {
        const data = await apiCommand('apt_cache_search', { query });
        const stdout = data?.stdout || '';
        const stderr = data?.stderr || '';

        if (stderr) {
            storeList.innerHTML = `<div style="color: #ef4444; padding: 1rem;">Error: ${stderr}</div>`;
            return;
        }

        const lines = stdout.trim().split('\n').filter(line => line.trim());
        if (lines.length === 0) {
            storeList.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 2rem;">No packages found matching query.</div>';
            return;
        }

        storeList.innerHTML = '';
        lines.forEach(line => {
            const parts = line.split(/ - (.*)/s);
            const pkgName = parts[0].trim();
            const pkgDesc = parts[1] ? parts[1].trim() : 'No description available.';
            const safeId = pkgName.replace(/[^a-zA-Z0-9]/g, '-');
            
            const item = document.createElement('div');
            item.className = 'store-item-wrapper';
            item.style.background = 'rgba(255, 255, 255, 0.02)';
            item.style.border = '1px solid rgba(255, 255, 255, 0.05)';
            item.style.borderRadius = '8px';
            item.style.padding = '0.8rem 1rem';
            item.style.display = 'flex';
            item.style.flexDirection = 'column';
            item.style.gap = '0.5rem';
            
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div class="store-item-info" style="display: flex; flex-direction: column; gap: 0.2rem; flex: 1; margin-right: 1rem;">
                        <span class="store-item-name" style="font-weight: 600; font-size: 0.85rem; color: #ffffff;">${pkgName}</span>
                        <span class="store-item-desc" style="font-size: 0.75rem; color: var(--text-secondary); line-height: 1.3;">${pkgDesc}</span>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="fm-btn" style="background: rgba(255,255,255,0.05); color: #fff; width: 80px;" onclick="togglePackageDetails('${pkgName}', this)">Details</button>
                        <button class="fm-btn btn-action-${safeId}" style="background: var(--accent-orange); color: #fff; width: 90px;" onclick="handlePackageAction('${pkgName}', this)">Install</button>
                    </div>
                </div>
                <div class="store-item-details-box-${safeId}" style="display: none; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 0.6rem; font-size: 0.75rem; color: var(--text-secondary); font-family: var(--font-mono); line-height: 1.4;">
                    Loading details...
                </div>
            `;
            storeList.appendChild(item);
            
            // Check status in background
            checkPackageStatusSilent(pkgName);
        });
    } catch (e) {
        storeList.innerHTML = '<div style="color: #ef4444; text-align: center; padding: 1rem;">Connection Error</div>';
    }
}

// Bind Enter key to package search
storeSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        searchPackages();
    }
});

async function checkPackageStatusSilent(pkgName) {
    try {
        const res = await apiCommand('dpkg_query_status', { pkg: pkgName });
        const isInstalled = res && res.exit_code === 0;
        updatePackageButton(pkgName, isInstalled);
    } catch (e) {
        updatePackageButton(pkgName, false);
    }
}

function updatePackageButton(pkgName, isInstalled) {
    const safeId = pkgName.replace(/[^a-zA-Z0-9]/g, '-');
    const btn = document.querySelector(`.btn-action-${safeId}`);
    if (!btn) return;
    if (isInstalled) {
        btn.textContent = 'Uninstall';
        btn.style.background = 'rgba(239, 68, 68, 0.15)';
        btn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
        btn.style.color = '#ef4444';
    } else {
        btn.textContent = 'Install';
        btn.style.background = 'var(--accent-orange)';
        btn.style.borderColor = 'transparent';
        btn.style.color = '#fff';
    }
}

async function handlePackageAction(pkgName, btnEl) {
    if (btnEl.textContent === 'Uninstall') {
        await uninstallPackage(pkgName);
    } else {
        await installPackage(pkgName);
    }
}

async function togglePackageDetails(pkgName, btnEl) {
    const safeId = pkgName.replace(/[^a-zA-Z0-9]/g, '-');
    const detailsBox = document.querySelector(`.store-item-details-box-${safeId}`);
    if (!detailsBox) return;
    
    if (detailsBox.style.display === 'block') {
        detailsBox.style.display = 'none';
        btnEl.textContent = 'Details';
        return;
    }
    
    detailsBox.style.display = 'block';
    btnEl.textContent = 'Close';
    detailsBox.innerHTML = '<div style="color: var(--text-secondary);">Querying WSL Ubuntu package repository...</div>';
    
    try {
        // Run show and status query in parallel
        const [showRes, statusRes] = await Promise.all([
            apiCommand('apt_cache_show', { pkg: pkgName }).catch(() => null),
            apiCommand('dpkg_query_status', { pkg: pkgName }).catch(() => null)
        ]);
        
        const isInstalled = statusRes && statusRes.exit_code === 0;
        updatePackageButton(pkgName, isInstalled);
        
        let size = 'Unknown';
        let version = 'Unknown';
        let depends = 'None';
        let showText = showRes?.stdout || '';
        
        if (showText) {
            const lines = showText.split('\n');
            lines.forEach(line => {
                if (line.startsWith('Installed-Size:')) size = line.replace('Installed-Size:', '').trim();
                if (line.startsWith('Version:')) version = line.replace('Version:', '').trim();
                if (line.startsWith('Depends:')) depends = line.replace('Depends:', '').trim();
            });
        }
        
        let detailsHtml = `
            <div style="margin-bottom: 0.4rem;"><strong style="color: #fff;">Status:</strong> ${isInstalled ? '<span style="color: #10b981;">Installed</span>' : '<span style="color: var(--text-secondary);">Not installed</span>'}</div>
            <div style="margin-bottom: 0.4rem;"><strong style="color: #fff;">Latest Version:</strong> ${version}</div>
            <div style="margin-bottom: 0.4rem;"><strong style="color: #fff;">WSL Install Size:</strong> ${size}</div>
            <div style="margin-bottom: 0.6rem; word-break: break-all;"><strong style="color: #fff;">Dependencies:</strong> ${depends}</div>
        `;
        
        // If not installed, show dependency simulation
        if (!isInstalled) {
            detailsHtml += `<div class="sim-box-${safeId}" style="border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 0.5rem; margin-top: 0.5rem;">
                <button class="fm-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background: rgba(255,255,255,0.03);" onclick="runDependencySimulation('${pkgName}')">Preview Dependency Impact</button>
            </div>`;
        }
        
        detailsBox.innerHTML = detailsHtml;
        
    } catch (err) {
        detailsBox.innerHTML = `<div style="color: #ef4444;">Error loading info: ${err.message}</div>`;
    }
}

async function runDependencySimulation(pkgName) {
    const safeId = pkgName.replace(/[^a-zA-Z0-9]/g, '-');
    const simBox = document.querySelector(`.sim-box-${safeId}`);
    if (!simBox) return;
    simBox.innerHTML = '<span style="color: var(--text-secondary);">Calculating dependency changes...</span>';
    
    try {
        const res = await apiCommand('apt_get_install_simulate', { pkg: pkgName });
        const stdout = res?.stdout || '';
        
        if (res.exit_code !== 0) {
            simBox.innerHTML = `<span style="color: #ef4444;">Simulation failed. Try running apt-get update.</span>`;
            return;
        }
        
        let newPkgs = [];
        let diskChange = '0 B';
        let downloadSize = '0 B';
        
        const lines = stdout.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes('The following NEW packages will be installed:')) {
                // Read next line(s) until empty or other header
                let j = i + 1;
                while (j < lines.length && lines[j] && !lines[j].includes('packages')) {
                    newPkgs.push(...lines[j].trim().split(/\s+/));
                    j++;
                }
            }
            if (line.includes('Need to get')) {
                const match = line.match(/Need to get\s+([0-9.]+\s+[a-zA-Z]+)/);
                if (match) downloadSize = match[1];
            }
            if (line.includes('additional disk space will be used')) {
                const match = line.match(/([0-9.]+\s+[a-zA-Z]+)\s+of additional disk space/);
                if (match) diskChange = match[1];
            }
        }
        
        simBox.innerHTML = `
            <div style="color: #e95420; font-weight: 600; margin-bottom: 0.3rem;">Simulated Install Preview:</div>
            <div style="margin-left: 0.5rem;">
                <div>• Download Archive Size: <strong>${downloadSize}</strong></div>
                <div>• Disk Space Required: <strong>${diskChange}</strong></div>
                <div style="margin-top: 0.2rem;">• Packages to Install (${newPkgs.length}):</div>
                <div style="color: var(--text-secondary); max-height: 60px; overflow-y: auto; margin-left: 0.5rem; font-size: 0.7rem; word-break: break-all;">
                    ${newPkgs.join(', ') || pkgName}
                </div>
            </div>
        `;
    } catch (e) {
        simBox.innerHTML = `<span style="color: #ef4444;">Failed to simulate install: ${e.message}</span>`;
    }
}

async function installPackage(pkgName) {
    if (!confirm(`Are you sure you want to install package '${pkgName}'?`)) return;
    
    // Disable buttons
    document.querySelectorAll('.store-item button, .store-item-wrapper button').forEach(btn => btn.disabled = true);
    
    installProgressContainer.style.display = 'flex';
    installProgressBar.style.width = '0%';
    installProgressBar.style.backgroundColor = 'var(--accent-orange)';
    installStatusText.textContent = `Initializing installation of ${pkgName}...`;
    installPct.textContent = '0%';
    
    let currentProgress = 5;
    const progressInterval = setInterval(() => {
        if (currentProgress < 90) {
            currentProgress += Math.floor(Math.random() * 5) + 1;
            if (currentProgress > 90) currentProgress = 90;
            
            installProgressBar.style.width = `${currentProgress}%`;
            installPct.textContent = `${currentProgress}%`;
            
            if (currentProgress > 75) {
                installStatusText.textContent = `Configuring and starting ${pkgName}...`;
            } else if (currentProgress > 50) {
                installStatusText.textContent = `Unpacking ${pkgName}...`;
            } else if (currentProgress > 30) {
                installStatusText.textContent = `Downloading package archives...`;
            } else {
                installStatusText.textContent = `Calculating dependencies for ${pkgName}...`;
            }
        }
    }, 450);

    try {
        const data = await apiCommand('apt_get_install', { pkg: pkgName });
        clearInterval(progressInterval);

        printOutput(`<span class="prompt">root@ubuntu-24.04:~$</span> apt-get install -y ${pkgName}`);
        if (data.stdout) printOutput(data.stdout);
        if (data.stderr) printOutput(data.stderr, 'stderr-msg');

        if (data.exit_code === 0) {
            installProgressBar.style.width = '100%';
            installPct.textContent = '100%';
            installStatusText.textContent = `Successfully installed ${pkgName}!`;
            showToast(`Successfully installed ${pkgName}!`);
            updatePackageButton(pkgName, true);
        } else {
            // Check for Package Not Found
            const outText = (data.stdout || '') + (data.stderr || '');
            if (outText.includes('Unable to locate package') || outText.includes('has no installation candidate')) {
                showPackageNotFoundError(pkgName);
            } else {
                installProgressBar.style.width = '100%';
                installProgressBar.style.backgroundColor = '#ef4444';
                installPct.textContent = 'Failed';
                installStatusText.textContent = `Error: APT failed to install ${pkgName}. Check terminal log.`;
                showToast('Installation failed!');
            }
        }
    } catch (e) {
        clearInterval(progressInterval);
        installStatusText.textContent = `Error: ${e.message}`;
        installProgressBar.style.backgroundColor = '#ef4444';
        showToast('Error occurred!');
    }
    
    setTimeout(() => {
        installProgressContainer.style.display = 'none';
        document.querySelectorAll('.store-item button, .store-item-wrapper button').forEach(btn => btn.disabled = false);
    }, 4000);
}

async function uninstallPackage(pkgName) {
    if (!confirm(`Are you sure you want to remove package '${pkgName}'?`)) return;
    
    document.querySelectorAll('.store-item button, .store-item-wrapper button').forEach(btn => btn.disabled = true);
    
    installProgressContainer.style.display = 'flex';
    installProgressBar.style.width = '0%';
    installProgressBar.style.backgroundColor = 'var(--accent-orange)';
    installStatusText.textContent = `Removing package ${pkgName}...`;
    installPct.textContent = '0%';
    
    let currentProgress = 5;
    const progressInterval = setInterval(() => {
        if (currentProgress < 90) {
            currentProgress += Math.floor(Math.random() * 8) + 2;
            if (currentProgress > 90) currentProgress = 90;
            installProgressBar.style.width = `${currentProgress}%`;
            installPct.textContent = `${currentProgress}%`;
        }
    }, 300);

    try {
        const data = await apiCommand('apt_get_remove', { pkg: pkgName });
        clearInterval(progressInterval);

        printOutput(`<span class="prompt">root@ubuntu-24.04:~$</span> apt-get remove -y ${pkgName}`);
        if (data.stdout) printOutput(data.stdout);
        if (data.stderr) printOutput(data.stderr, 'stderr-msg');

        if (data.exit_code === 0) {
            installProgressBar.style.width = '100%';
            installPct.textContent = '100%';
            installStatusText.textContent = `Successfully removed ${pkgName}!`;
            showToast(`Successfully removed ${pkgName}!`);
            updatePackageButton(pkgName, false);
        } else {
            installProgressBar.style.width = '100%';
            installProgressBar.style.backgroundColor = '#ef4444';
            installPct.textContent = 'Failed';
            installStatusText.textContent = `Error: Failed to remove ${pkgName}.`;
            showToast('Uninstallation failed!');
        }
    } catch (e) {
        clearInterval(progressInterval);
        installStatusText.textContent = `Error: ${e.message}`;
        installProgressBar.style.backgroundColor = '#ef4444';
    }
    
    setTimeout(() => {
        installProgressContainer.style.display = 'none';
        document.querySelectorAll('.store-item button, .store-item-wrapper button').forEach(btn => btn.disabled = false);
    }, 4000);
}

function showPackageNotFoundError(pkgName) {
    installProgressBar.style.width = '100%';
    installProgressBar.style.backgroundColor = '#ef4444';
    installPct.textContent = 'Failed';
    installStatusText.innerHTML = `
        <span style="color: #ef4444;">Package '${pkgName}' not found in local cache.</span>
        <button class="fm-btn" style="display: inline-block; padding: 0.15rem 0.5rem; font-size: 0.7rem; margin-left: 0.5rem; background: #fff; color: #000; border: none; font-weight: 600;" onclick="triggerAptGetUpdate('${pkgName}')">Run apt-get update</button>
    `;
}

async function triggerAptGetUpdate(retryPkg) {
    installProgressBar.style.width = '0%';
    installProgressBar.style.backgroundColor = 'var(--accent-orange)';
    installStatusText.textContent = 'Running apt-get update in WSL Ubuntu...';
    installPct.textContent = '0%';
    
    let currentProgress = 5;
    const progressInterval = setInterval(() => {
        if (currentProgress < 90) {
            currentProgress += 3;
            installProgressBar.style.width = `${currentProgress}%`;
            installPct.textContent = `${currentProgress}%`;
        }
    }, 400);
    
    try {
        const data = await apiCommand('apt_get_update', {});
        clearInterval(progressInterval);
        
        printOutput('<span class="prompt">root@ubuntu-24.04:~$</span> apt-get update');
        if (data.stdout) printOutput(data.stdout);
        
        if (data.exit_code === 0) {
            installProgressBar.style.width = '100%';
            installPct.textContent = '100%';
            installStatusText.textContent = 'Package index updated! Retrying install...';
            showToast('Package cache updated!');
            
            setTimeout(() => {
                installPackage(retryPkg);
            }, 1500);
        } else {
            installProgressBar.style.width = '100%';
            installProgressBar.style.backgroundColor = '#ef4444';
            installStatusText.textContent = 'Failed to update package cache.';
        }
    } catch (e) {
        clearInterval(progressInterval);
        installProgressBar.style.backgroundColor = '#ef4444';
        installStatusText.textContent = 'Error: ' + e.message;
    }
}

// ================= Properties & Permissions Logic =================
let currentPropPath = '';

async function openProperties(filename, isDir) {
    const targetPath = currentPath.replace(/\/$/, '') + '/' + filename;
    currentPropPath = targetPath;
    
    document.getElementById('prop-name').textContent = filename;
    document.getElementById('prop-path').textContent = targetPath;
    document.getElementById('prop-size').textContent = 'Loading...';
    document.getElementById('prop-owner').textContent = 'Loading...';
    
    // Reset checkboxes
    const checkboxes = ['ur', 'uw', 'ux', 'gr', 'gw', 'gx', 'or', 'ow', 'ox'];
    checkboxes.forEach(cb => document.getElementById(`perm-${cb}`).checked = false);
    
    document.getElementById('properties-modal').classList.add('open');
    
    try {
        const data = await apiExecuteLegacy(`stat -c "%A %a %U %G %s" "${targetPath}"`);
        if (data) {
            if (data.stdout) {
                const parts = data.stdout.trim().split(/\s+/);
                if (parts.length >= 5) {
                    const humanPerms = parts[0]; // e.g. -rwxr-xr-x
                    const octalPerms = parts[1]; // e.g. 755
                    const owner = parts[2];
                    const group = parts[3];
                    const sizeBytes = parseInt(parts[4]);
                    
                    let sizeStr = `${sizeBytes} B`;
                    if (sizeBytes > 1024 * 1024) {
                        sizeStr = `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
                    } else if (sizeBytes > 1024) {
                        sizeStr = `${(sizeBytes / 1024).toFixed(2)} KB`;
                    }
                    
                    document.getElementById('prop-size').textContent = isDir ? 'Directory' : sizeStr;
                    document.getElementById('prop-owner').textContent = `${owner} : ${group}`;
                    
                    // Set checkboxes based on humanPerms (length 10, index 0 is type e.g. - or d)
                    if (humanPerms.length >= 10) {
                        document.getElementById('perm-ur').checked = humanPerms[1] === 'r';
                        document.getElementById('perm-uw').checked = humanPerms[2] === 'w';
                        document.getElementById('perm-ux').checked = humanPerms[3] === 'x';
                        document.getElementById('perm-gr').checked = humanPerms[4] === 'r';
                        document.getElementById('perm-gw').checked = humanPerms[5] === 'w';
                        document.getElementById('perm-gx').checked = humanPerms[6] === 'x';
                        document.getElementById('perm-or').checked = humanPerms[7] === 'r';
                        document.getElementById('perm-ow').checked = humanPerms[8] === 'w';
                        document.getElementById('perm-ox').checked = humanPerms[9] === 'x';
                    }
                }
            }
        }
    } catch (e) {
        showToast('Error loading properties');
    }
}

function closeProperties() {
    document.getElementById('properties-modal').classList.remove('open');
    currentPropPath = '';
}

async function saveProperties() {
    if (!currentPropPath) return;
    
    let u = 0, g = 0, o = 0;
    if (document.getElementById('perm-ur').checked) u += 4;
    if (document.getElementById('perm-uw').checked) u += 2;
    if (document.getElementById('perm-ux').checked) u += 1;
    
    if (document.getElementById('perm-gr').checked) g += 4;
    if (document.getElementById('perm-gw').checked) g += 2;
    if (document.getElementById('perm-gx').checked) g += 1;
    
    if (document.getElementById('perm-or').checked) o += 4;
    if (document.getElementById('perm-ow').checked) o += 2;
    if (document.getElementById('perm-ox').checked) o += 1;
    
    const octalVal = `${u}${g}${o}`;
    
    try {
        const data = await apiExecuteLegacy(`chmod ${octalVal} "${currentPropPath}"`);
        if (data && data.exit_code === 0) {
            showToast(`Permissions updated to ${octalVal}`);
            closeProperties();
            refreshFiles();
        } else {
            showToast('Failed to apply permissions');
        }
    } catch (e) {
        showToast('Error applying permissions');
    }
}

// ================= Network Diagnostics Logic =================
async function runNetworkDiagnostics() {
    const host = document.getElementById('net-host').value.trim();
    const tool = document.getElementById('net-tool').value;
    const outputBox = document.getElementById('net-output');
    
    if (!host) {
        outputBox.textContent = 'Please enter a host or IP address.';
        return;
    }
    
    outputBox.textContent = `Running ${tool} on ${host} inside Ubuntu, please wait...\n`;
    
    let cmd = '';
    if (tool === 'ping') {
        cmd = `ping -c 4 "${host}"`;
    } else if (tool === 'nslookup') {
        cmd = `nslookup "${host}"`;
    } else if (tool === 'nmap') {
        cmd = `nmap -F "${host}"`;
    }
    
    try {
        const data = await apiExecuteLegacy(cmd);
        let outText = '';
        if (data.stdout) outText += data.stdout;
        if (data.truncated_stdout) outText += '\n[Output truncated due to size limit]';
        if (data.stderr) outText += '\nErrors:\n' + data.stderr;
        if (data.truncated_stderr) outText += '\n[Error output truncated due to size limit]';
        if (!data.stdout && !data.stderr) outText += '[No output received]';
        
        outputBox.textContent = outText;
    } catch (e) {
        outputBox.textContent = `Error: ${e.message}`;
    }
}

async function downloadFile(filename) {
    const filePath = currentPath.replace(/\/$/, '') + '/' + filename;
    showToast(`Downloading ${filename}...`);
    try {
        const data = await apiExecuteLegacy(`cat "${filePath}"`);
        if (data && data.stdout !== undefined) {
            const blob = new Blob([data.stdout], { type: 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showToast('Downloaded successfully!');
        } else {
            alert('Failed to download file: ' + (data?.stderr || 'No content'));
        }
    } catch (e) {
        alert('Failed to download file: ' + e.message);
    }
}

function triggerFileUpload() {
    document.getElementById('file-upload-input').click();
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        const content = e.target.result;
        const base64Content = content.split(',')[1];
        const targetPath = currentPath.replace(/\/$/, '') + '/' + file.name;
        
        showToast(`Uploading ${file.name}...`);
        try {
            await apiCommand('write_file_base64', { path: targetPath, b64: base64Content });
            showToast('Uploaded successfully!');
            refreshFiles();
        } catch (err) {
            alert('Upload failed: ' + err.message);
        }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

async function startDedicatedCleanup() {
    const cleanTmp = document.getElementById('clean-tmp')?.checked ?? false;
    const cleanApt = document.getElementById('clean-apt')?.checked ?? false;
    const cleanAutoremove = document.getElementById('clean-autoremove')?.checked ?? false;
    const cleanLogs = document.getElementById('clean-logs')?.checked ?? false;
    
    const statusBox = document.getElementById('clean-app-status-box');
    const statusText = document.getElementById('clean-app-text');
    const pctText = document.getElementById('clean-app-pct');
    const progressBar = document.getElementById('clean-app-progress-bar');
    const consoleBox = document.getElementById('clean-app-console');
    const btn = document.getElementById('btn-clean-app');
    
    if (!cleanTmp && !cleanApt && !cleanAutoremove && !cleanLogs) {
        alert('Please select at least one component to clean.');
        return;
    }
    
    // Disable inputs
    btn.disabled = true;
    document.querySelectorAll('#win-cleaner input[type="checkbox"]').forEach(cb => cb.disabled = true);
    
    // Reset status UI
    statusBox.style.display = 'flex';
    progressBar.style.width = '0%';
    progressBar.style.backgroundColor = 'var(--accent-orange)';
    statusText.textContent = 'Initializing cleanup...';
    pctText.textContent = '0%';
    consoleBox.textContent = 'Preparing environment...\n';
    
    let progress = 5;
    const interval = setInterval(() => {
        if (progress < 90) {
            progress += Math.floor(Math.random() * 6) + 2;
            if (progress > 90) progress = 90;
            progressBar.style.width = `${progress}%`;
            pctText.textContent = `${progress}%`;
            
            if (progress > 70) {
                statusText.textContent = 'Vacuuming systemd journal logs...';
            } else if (progress > 45) {
                statusText.textContent = 'Cleaning APT cache & removing unused packages...';
            } else if (progress > 20) {
                statusText.textContent = 'Wiping temporary directory files...';
            } else {
                statusText.textContent = 'Connecting to root execution bridge...';
            }
        }
    }, 400);
    
    try {
        const data = await apiCommand('system_cleanup', {
            clean_tmp: cleanTmp,
            clean_apt: cleanApt,
            clean_autoremove: cleanAutoremove,
            clean_logs: cleanLogs
        });
        
        clearInterval(interval);
        
        // Print stdout/stderr output into consoleBox
        let consoleOutput = '--- WSL CLEANUP LOGS ---\n';
        if (data.stdout) consoleOutput += data.stdout;
        if (data.stderr) consoleOutput += '\nstderr:\n' + data.stderr;
        if (!data.stdout && !data.stderr) consoleOutput += '[No output from command]';
        consoleBox.textContent = consoleOutput;
        consoleBox.scrollTop = consoleBox.scrollHeight;
        
        if (data.exit_code === 0) {
            progressBar.style.width = '100%';
            pctText.textContent = '100%';
            statusText.textContent = 'System cleaned successfully!';
            showToast('System Cleanup Completed!');
            
            // Trigger a stats refresh to update Disk Usage UI
            if (typeof fetchSystemStats === 'function') {
                setTimeout(fetchSystemStats, 1000);
            }
        } else {
            progressBar.style.width = '100%';
            progressBar.style.backgroundColor = '#ef4444';
            pctText.textContent = 'Failed';
            statusText.textContent = `Cleanup failed (Exit code: ${data.exit_code})`;
            showToast('System Cleanup Failed!');
        }
    } catch (e) {
        clearInterval(interval);
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#ef4444';
        pctText.textContent = 'Error';
        statusText.textContent = 'Error during cleanup: ' + e.message;
        consoleBox.textContent += `\nError: ${e.message}`;
        showToast('Error during cleanup!');
    } finally {
        setTimeout(() => {
            btn.disabled = false;
            document.querySelectorAll('#win-cleaner input[type="checkbox"]').forEach(cb => cb.disabled = false);
        }, 3000);
    }
}

// ================= Settings Page Navigation & Preferences Logic =================
function switchSettingsTab(tabId) {
    // Update active tab button styles
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-secondary)';
        const icon = btn.querySelector('i');
        if (icon) icon.style.color = 'var(--text-secondary)';
    });
    
    const activeBtn = document.getElementById(`tab-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.background = 'rgba(233, 84, 32, 0.1)';
        activeBtn.style.color = '#fff';
        const icon = activeBtn.querySelector('i');
        if (icon) icon.style.color = 'var(--accent-orange)';
    }
    
    // Toggle pane visibility
    document.querySelectorAll('.settings-pane').forEach(pane => {
        pane.style.display = 'none';
    });
    
    const activePane = document.getElementById(`set-pane-${tabId}`);
    if (activePane) {
        activePane.style.display = 'flex';
    }
    
    // Fetch system info if needed
    if (tabId === 'system') {
        fetchSettingsSystemInfo();
    } else if (tabId === 'network') {
        fetchSettingsNetworkInfo();
    } else if (tabId === 'services') {
        fetchSettingsServices();
    } else if (tabId === 'profile') {
        fetchSettingsProfileInfo();
    }
}

async function fetchSettingsProfileInfo() {
    const userEl = document.getElementById('set-profile-user');
    if (!userEl) return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/get_profile`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfToken },
            credentials: 'include'
        });
        if (res.ok) {
            const data = await res.json();
            userEl.value = data.username || '';
        }
    } catch (e) {
        showToast('Error loading profile: ' + e.message);
    }
}

async function saveUserProfile() {
    const user = document.getElementById('set-profile-user')?.value ?? '';
    const pass = document.getElementById('set-profile-pass')?.value ?? '';
    const confirm = document.getElementById('set-profile-confirm')?.value ?? '';

    if (!user.trim()) {
        showToast('Username cannot be empty');
        return;
    }
    if (!pass.trim()) {
        showToast('Password cannot be empty');
        return;
    }
    if (pass !== confirm) {
        showToast('Passwords do not match!');
        return;
    }

    try {
        const res = await fetch(`${BACKEND_URL}/api/profile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ username: user, password: pass })
        });
        if (res.ok) {
            showToast('Profile credentials updated successfully!');
            document.getElementById('set-profile-pass').value = '';
            document.getElementById('set-profile-confirm').value = '';
        } else {
            const err = await res.json();
            showToast('Failed to update credentials: ' + (err.error || 'Unknown error'));
        }
    } catch (e) {
        showToast('Error updating credentials: ' + e.message);
    }
}

async function fetchSettingsSystemInfo() {
    const osEl = document.getElementById('set-sys-os');
    const kernelEl = document.getElementById('set-sys-kernel');
    const archEl = document.getElementById('set-sys-arch');
    const shellEl = document.getElementById('set-sys-shell');
    const uptimeEl = document.getElementById('set-sys-uptime');
    
    if (osEl) osEl.textContent = 'Querying OS version...';
    if (kernelEl) kernelEl.textContent = 'Querying Kernel...';
    if (archEl) archEl.textContent = 'Querying Architecture...';
    if (shellEl) shellEl.textContent = 'Querying Shell path...';
    if (uptimeEl) uptimeEl.textContent = 'Querying Uptime...';
    
    try {
        // Run commands in parallel
        const [osRes, unameRes, shellRes, uptimeRes] = await Promise.all([
            apiCommand('run_raw', { command: 'cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'' }).catch(() => null),
            apiCommand('run_raw', { command: 'uname -srm' }).catch(() => null),
            apiCommand('run_raw', { command: 'echo $SHELL' }).catch(() => null),
            apiCommand('run_raw', { command: 'uptime -p' }).catch(() => null)
        ]);
        
        if (osEl) osEl.textContent = osRes?.stdout?.trim() || 'Ubuntu 24.04 LTS';
        
        if (unameRes?.stdout) {
            const parts = unameRes.stdout.trim().split(/\s+/);
            if (kernelEl) kernelEl.textContent = parts.slice(0, 2).join(' ') || 'Linux Kernel';
            if (archEl) archEl.textContent = parts[2] || 'x86_64';
        } else {
            if (kernelEl) kernelEl.textContent = 'Unknown Linux Kernel';
            if (archEl) archEl.textContent = 'Unknown Arch';
        }
        
        if (shellEl) shellEl.textContent = shellRes?.stdout?.trim() || '/bin/bash';
        if (uptimeEl) uptimeEl.textContent = uptimeRes?.stdout?.trim() || 'uptime unknown';
        
    } catch (e) {
        showToast('Failed to fetch system info');
    }
}

function saveFsRootPreference() {
    const rootInput = document.getElementById('pref-fs-root');
    if (!rootInput) return;
    
    const newRoot = rootInput.value.trim();
    if (!newRoot.startsWith('/')) {
        alert('Invalid Path: Filesystem root must start with a slash (/).');
        return;
    }
    
    currentPath = newRoot;
    showToast(`Filesystem root updated to ${newRoot}`);
    refreshFiles();
}

function changeEditorTheme(themeName) {
    if (!monacoLoaded || !editorInstance) return;
    
    try {
        monaco.editor.setTheme(themeName);
        showToast(`Editor theme changed to ${themeName}`);
    } catch (e) {
        showToast('Failed to apply editor theme');
    }
}

async function fetchSettingsNetworkInfo() {
    const netEl = document.getElementById('set-net-interfaces');
    if (!netEl) return;
    netEl.textContent = 'Querying interface stats from WSL Ubuntu...';
    
    try {
        const res = await apiCommand('run_raw', { command: 'ip -brief addr show' });
        netEl.textContent = res?.stdout || '[No interfaces found]';
    } catch (e) {
        netEl.textContent = 'Error querying interfaces: ' + e.message;
    }
}

async function fetchSettingsServices() {
    const srvEl = document.getElementById('set-services-list');
    if (!srvEl) return;
    srvEl.textContent = 'Querying service states from WSL Ubuntu...';
    
    try {
        const res = await apiCommand('run_raw', { command: 'service --status-all' });
        srvEl.textContent = res?.stdout || '[No services found]';
    } catch (e) {
        srvEl.textContent = 'Error querying services: ' + e.message;
    }
}

// ================= Draggable Desktop Shortcuts =================
function initDraggableShortcuts() {
    const shortcuts = document.querySelectorAll('.shortcut');
    const desktop = document.getElementById('desktop');
    if (!desktop) return;

    shortcuts.forEach((shortcut, index) => {
        // Arrange shortcuts initially in a vertical grid column
        shortcut.style.position = 'absolute';
        const cols = Math.floor(index / 8);
        const rows = index % 8;
        const x = 20 + cols * 96;
        const y = 20 + rows * 96;
        
        shortcut.style.left = `${x}px`;
        shortcut.style.top = `${y}px`;
        shortcut.style.margin = '0'; // reset static margin layout
        
        let dragX = 0, dragY = 0;
        
        shortcut.addEventListener('mousedown', (e) => {
            // Drag only on left click
            if (e.button !== 0) return;
            if (e.target.closest('.win-btn')) return;
            
            // Bring dragged icon to front locally during drag and disable transitions to avoid lag
            shortcut.style.zIndex = '1000';
            shortcut.style.transition = 'none';
            
            const rect = shortcut.getBoundingClientRect();
            const desktopRect = desktop.getBoundingClientRect();
            
            dragX = e.clientX - rect.left;
            dragY = e.clientY - rect.top;
            
            const handleMouseMove = (moveEvent) => {
                let left = moveEvent.clientX - desktopRect.left - dragX;
                let top = moveEvent.clientY - desktopRect.top - dragY;
                
                // Boundaries check
                left = Math.max(10, Math.min(left, desktopRect.width - rect.width - 10));
                top = Math.max(10, Math.min(top, desktopRect.height - rect.height - 10));
                
                shortcut.style.left = `${left}px`;
                shortcut.style.top = `${top}px`;
            };
            
            const handleMouseUp = () => {
                shortcut.style.zIndex = '';
                
                // Snap to 96px grid on mouse up
                const currentLeft = parseFloat(shortcut.style.left);
                const currentTop = parseFloat(shortcut.style.top);
                
                let col = Math.round((currentLeft - 20) / 96);
                let row = Math.round((currentTop - 20) / 96);
                
                col = Math.max(0, col);
                row = Math.max(0, row);
                
                const maxCols = Math.max(1, Math.floor((desktopRect.width - 20) / 96));
                const maxRows = Math.max(1, Math.floor((desktopRect.height - 20) / 96));
                
                col = Math.min(col, maxCols - 1);
                row = Math.min(row, maxRows - 1);
                
                const snappedX = 20 + col * 96;
                const snappedY = 20 + row * 96;
                
                // Re-enable transition for a smooth snapping animation
                shortcut.style.transition = 'left 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.15), top 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.15)';
                shortcut.style.left = `${snappedX}px`;
                shortcut.style.top = `${snappedY}px`;
                
                // Restore default CSS transitions after snap animation completes
                setTimeout(() => {
                    shortcut.style.transition = '';
                }, 200);
                
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });
    });
}

// ================= DevOps & Deployment Center =================
function switchDeployTab(tabId) {
    document.querySelectorAll('.deploy-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-secondary)';
        const icon = btn.querySelector('i');
        if (icon) icon.style.color = 'var(--text-secondary)';
    });

    const activeBtn = document.getElementById(`deploy-tab-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.background = 'rgba(233, 84, 32, 0.1)';
        activeBtn.style.color = '#fff';
        const icon = activeBtn.querySelector('i');
        if (icon) icon.style.color = 'var(--accent-orange)';
    }

    document.querySelectorAll('.deploy-pane').forEach(pane => {
        pane.style.display = 'none';
    });

    const activePane = document.getElementById(`deploy-pane-${tabId}`);
    if (activePane) {
        activePane.style.display = 'flex';
    }

    if (tabId === 'env') {
        fetchDeployEnv();
    } else if (tabId === 'nginx') {
        fetchDeployNginx();
    }
}

async function refreshDeployOverview() {
    const sysdEl = document.getElementById('dep-systemd-status');
    const dockEl = document.getElementById('dep-docker-status');
    const listEl = document.getElementById('dep-containers-list');

    if (sysdEl) sysdEl.textContent = 'Querying...';
    if (dockEl) dockEl.textContent = 'Querying...';
    if (listEl) listEl.textContent = 'Querying running containers...';

    // Systemd Status
    try {
        const res = await apiCommand('run_raw', { command: 'systemctl status webos.service | grep Active || echo "Inactive"' });
        if (sysdEl) {
            const out = res?.stdout || '';
            if (out.includes('running') || out.includes('active')) {
                sysdEl.innerHTML = '<span style="color: #10b981;"><i class="fa-solid fa-circle-check"></i> Active (Running)</span>';
            } else {
                sysdEl.innerHTML = '<span style="color: #6b7280;"><i class="fa-solid fa-circle-stop"></i> Inactive</span>';
            }
        }
    } catch (e) {
        if (sysdEl) sysdEl.innerHTML = `<span style="color: #ef4444;">Error: ${e.message}</span>`;
    }

    // Docker Status
    try {
        const res = await apiCommand('run_raw', { command: 'command -v docker &>/dev/null && (docker info &>/dev/null && echo "Active" || echo "Stopped") || echo "NotInstalled"' });
        if (dockEl) {
            const out = (res?.stdout || '').trim();
            if (out === 'Active') {
                dockEl.innerHTML = '<span style="color: #10b981;"><i class="fa-solid fa-circle-check"></i> Active (Running)</span>';
                // Containers List (Only run if docker is active)
                try {
                    const containersRes = await apiCommand('run_raw', { command: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "[No containers running]"' });
                    if (listEl) {
                        listEl.textContent = containersRes?.stdout || '[No containers running]';
                    }
                } catch (err) {
                    if (listEl) listEl.textContent = 'Failed to fetch containers: ' + err.message;
                }
            } else if (out === 'Stopped') {
                dockEl.innerHTML = '<span style="color: #f59e0b;"><i class="fa-solid fa-circle-exclamation"></i> Service Stopped</span>';
                if (listEl) listEl.textContent = 'Docker service is installed but not running.';
            } else {
                dockEl.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Integration Missing</span>';
                if (listEl) {
                    listEl.innerHTML = `<div style="color: #fca5a5; padding: 0.5rem; line-height: 1.4;">
<strong style="color: #ff6b6b;"><i class="fa-solid fa-circle-exclamation"></i> Docker WSL Integration Required:</strong><br>
Docker is not enabled or installed in this WSL 2 distro.<br><br>
<span style="font-size: 0.75rem; color: var(--text-secondary); display: block; border-left: 2px solid var(--accent-orange); padding-left: 0.5rem;">
1. Open <strong>Docker Desktop</strong> on Windows.<br>
2. Go to <strong>Settings</strong> (gear icon) -> <strong>Resources</strong> -> <strong>WSL Integration</strong>.<br>
3. Enable integration for <strong>Ubuntu-24.04</strong>.<br>
4. Click <strong>Apply & Restart</strong>.
</span>
</div>`;
                }
            }
        }
    } catch (e) {
        if (dockEl) dockEl.innerHTML = `<span style="color: #ef4444;">Error: ${e.message}</span>`;
    }
}

async function runDeployCommand(action) {
    showToast(`Running deployment command: ${action}...`);
    let cmd = '';

    if (action === 'systemctl_status') {
        cmd = 'systemctl status webos.service || true';
    } else if (action === 'docker_status') {
        cmd = 'docker info || true';
    } else if (action === 'compose_up') {
        cmd = 'cd /mnt/d/ubuntu-web-os && docker compose up -d || docker-compose up -d';
    } else if (action === 'compose_down') {
        cmd = 'cd /mnt/d/ubuntu-web-os && docker compose down || docker-compose down';
    } else if (action === 'compose_build') {
        cmd = 'cd /mnt/d/ubuntu-web-os && docker compose build || docker-compose build';
    } else if (action === 'docker_prune') {
        cmd = 'docker system prune -f';
    } else if (action === 'nginx_test') {
        cmd = 'nginx -t || true';
    }

    try {
        const res = await apiCommand('run_raw', { command: cmd });
        showToast('DevOps command complete.');
        
        // Show console outputs in logs tab and switch to it for commands with logs/outputs
        const logConsole = document.getElementById('dep-logs-console');
        if (logConsole) {
            logConsole.textContent = `=== Execution Output for: ${cmd} ===\n\n` + (res?.stdout || '') + '\n' + (res?.stderr || '');
            switchDeployTab('logs');
        }
        
        // Refresh overview
        setTimeout(refreshDeployOverview, 1500);
    } catch (e) {
        showToast('DevOps command failed: ' + e.message);
    }
}

async function fetchDeployEnv() {
    const textarea = document.getElementById('dep-env-editor');
    if (!textarea) return;
    textarea.value = 'Loading environment file...';

    try {
        const res = await apiCommand('run_raw', { command: 'cat /mnt/d/ubuntu-web-os/.env 2>/dev/null || echo "No .env file found. Click Save to create one."' });
        textarea.value = res?.stdout || '';
    } catch (e) {
        textarea.value = 'Error reading file: ' + e.message;
    }
}

async function saveDeployEnv() {
    const textarea = document.getElementById('dep-env-editor');
    if (!textarea) return;
    const content = textarea.value.trim();
    if (!content) {
        showToast('Cannot save empty environment configuration!');
        return;
    }

    showToast('Saving environment changes...');
    try {
        // Safe multiline write using EOF
        const cmd = `cat << 'EOF' > /mnt/d/ubuntu-web-os/.env\n${content}\nEOF`;
        const res = await apiCommand('run_raw', { command: cmd });
        if (res?.exit_code === 0) {
            showToast('Environment (.env) saved successfully!');
        } else {
            showToast('Failed to save configuration: ' + (res?.stderr || 'Unknown error'));
        }
    } catch (e) {
        showToast('Error saving .env configuration: ' + e.message);
    }
}

async function fetchDeployNginx() {
    const textarea = document.getElementById('dep-nginx-editor');
    if (!textarea) return;
    textarea.value = 'Loading nginx configuration...';

    try {
        const res = await apiCommand('run_raw', { command: 'cat /mnt/d/ubuntu-web-os/nginx.conf 2>/dev/null || echo "No nginx.conf template found."' });
        textarea.value = res?.stdout || '';
    } catch (e) {
        textarea.value = 'Error reading nginx config: ' + e.message;
    }
}

async function fetchDeployLogs(type) {
    const logConsole = document.getElementById('dep-logs-console');
    if (!logConsole) return;
    logConsole.textContent = `Loading ${type} logs...`;

    let cmd = '';
    if (type === 'docker') {
        cmd = 'cd /mnt/d/ubuntu-web-os && (docker compose logs --tail=80 || docker-compose logs --tail=80) 2>&1';
    } else {
        cmd = 'journalctl -u webos --no-pager -n 80 2>&1 || tail -n 80 /var/log/syslog';
    }

    try {
        const res = await apiCommand('run_raw', { command: cmd });
        logConsole.textContent = res?.stdout || res?.stderr || '[No logs found]';
    } catch (e) {
        logConsole.textContent = 'Error querying logs: ' + e.message;
    }
}

// ================= Firefox Browser Controller =================
let browserInitialized = false;

function initBrowserIframe() {
    if (browserInitialized) return;
    browserInitialized = true;
    navigateBrowser('https://start.ubuntu.com');
}

function navigateBrowser(url) {
    const iframe = document.getElementById('browser-iframe');
    const input = document.getElementById('browser-url-input');
    if (!iframe || !input) return;

    // Sanitize URL
    let targetUrl = url.trim();
    if (!targetUrl.match(/^https?:\/\//i)) {
        if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
            targetUrl = 'https://' + targetUrl;
        } else {
            // Search query fallback using Google
            targetUrl = 'https://google.com/search?q=' + encodeURIComponent(targetUrl);
        }
    }

    input.value = targetUrl;

    if (targetUrl.startsWith('https://start.ubuntu.com') || targetUrl.includes('start.ubuntu.com') || targetUrl.includes('localhost:9500/api/get_profile')) {
        // Render a beautiful Ubuntu Start page directly inside the iframe to avoid iframe blocks
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Ubuntu Start Page</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                    body {
                        background: #77216f;
                        background: linear-gradient(135deg, #77216f 0%, #5e2750 100%);
                        color: #ffffff;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                        text-align: center;
                    }
                    .logo {
                        font-size: 3.5rem;
                        color: #E95420;
                        margin-bottom: 0.5rem;
                        animation: scaleUp 0.6s ease;
                    }
                    h1 {
                        font-size: 1.6rem;
                        font-weight: 300;
                        margin-bottom: 1.5rem;
                    }
                    .search-container {
                        width: 80%;
                        max-width: 480px;
                        display: flex;
                        background: rgba(255, 255, 255, 0.15);
                        border: 1px solid rgba(255, 255, 255, 0.25);
                        border-radius: 24px;
                        padding: 0.4rem 1rem;
                        align-items: center;
                        margin-bottom: 2rem;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                    }
                    .search-container i {
                        color: rgba(255,255,255,0.7);
                    }
                    .search-container input {
                        background: transparent;
                        border: none;
                        outline: none;
                        color: #fff;
                        padding: 0.5rem;
                        flex: 1;
                        font-size: 0.95rem;
                    }
                    .quick-links {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        gap: 1.2rem;
                        max-width: 440px;
                    }
                    .link-card {
                        background: rgba(255, 255, 255, 0.08);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        border-radius: 12px;
                        padding: 1rem;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        gap: 0.5rem;
                        text-decoration: none;
                        color: white;
                    }
                    .link-card:hover {
                        transform: translateY(-5px);
                        background: rgba(255, 255, 255, 0.18);
                        border-color: #E95420;
                    }
                    .link-card i {
                        font-size: 1.4rem;
                        color: #E95420;
                    }
                    .link-card span {
                        font-size: 0.75rem;
                        font-weight: 500;
                    }
                    @keyframes scaleUp {
                        from { transform: scale(0.85); opacity: 0; }
                        to { transform: scale(1); opacity: 1; }
                    }
                </style>
            </head>
            <body>
                <div class="logo"><i class="fa-brands fa-firefox-browser"></i></div>
                <h1>Firefox Start Portal</h1>
                
                <form onsubmit="event.preventDefault(); window.parent.navigateBrowser('https://google.com/search?q=' + encodeURIComponent(this.q.value));" class="search-container">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" name="q" placeholder="Search Google..." autocomplete="off">
                </form>

                <div class="quick-links">
                    <a href="javascript:void(0)" onclick="window.parent.navigateBrowser('https://ubuntu.com')" class="link-card">
                        <i class="fa-brands fa-ubuntu"></i>
                        <span>Ubuntu</span>
                    </a>
                    <a href="javascript:void(0)" onclick="window.parent.navigateBrowser('https://github.com')" class="link-card">
                        <i class="fa-brands fa-github"></i>
                        <span>GitHub</span>
                    </a>
                    <a href="javascript:void(0)" onclick="window.parent.navigateBrowser('https://stackoverflow.com')" class="link-card">
                        <i class="fa-brands fa-stack-overflow"></i>
                        <span>StackOverflow</span>
                    </a>
                    <a href="javascript:void(0)" onclick="window.parent.navigateBrowser('https://wikipedia.org')" class="link-card">
                        <i class="fa-solid fa-book-open"></i>
                        <span>Wikipedia</span>
                    </a>
                </div>
            </body>
            </html>
        `);
        doc.close();
    } else {
        // Load external sites directly inside the project iframe via the path-based backend proxy
        // Path-based proxy preserves relative URL resolution for JS chunks, CSS, fonts, etc.
        if (targetUrl.startsWith('https://')) {
            iframe.src = `${BACKEND_URL}/proxy/https/${targetUrl.substring(8)}`;
        } else if (targetUrl.startsWith('http://')) {
            iframe.src = `${BACKEND_URL}/proxy/http/${targetUrl.substring(7)}`;
        } else {
            iframe.src = `${BACKEND_URL}/proxy/https/${targetUrl}`;
        }
    }
}

function browserGoBack() {
    const iframe = document.getElementById('browser-iframe');
    if (!iframe) return;
    try {
        iframe.contentWindow.history.back();
    } catch (e) {
        showToast('Navigating back blocked by cross-origin security.');
    }
}

function browserGoForward() {
    const iframe = document.getElementById('browser-iframe');
    if (!iframe) return;
    try {
        iframe.contentWindow.history.forward();
    } catch (e) {
        showToast('Navigating forward blocked by cross-origin security.');
    }
}

function browserRefresh() {
    const iframe = document.getElementById('browser-iframe');
    const input = document.getElementById('browser-url-input');
    if (!iframe || !input) return;
    navigateBrowser(input.value);
}
