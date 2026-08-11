// wifi/app.js
const WIFI = (() => {
    let networks = [];

    let wifiEnabled = true;
    let scanning = false;
    let pendingConnectId = null;

    const listEl = document.getElementById('wifi-networks');
    const toggleEl = document.getElementById('wifi-toggle-chk');
    const scanBtn = document.getElementById('wifi-scan-btn');
    const trayIcon = document.getElementById('tray-wifi-icon');
    const pwdOverlay = document.getElementById('wifi-pwd-overlay');
    const pwdInput = document.getElementById('wifi-pwd-input');
    const pwdConnectBtn = document.getElementById('wifi-pwd-connect');
    const pwdCancelBtn = document.getElementById('wifi-pwd-cancel');
    const pwdTitle = document.getElementById('wifi-pwd-title');

    function init() {
        if (!listEl) return;
        bindEvents();
        renderList();
        updateTrayIcon();
    }

    function bindEvents() {
        if (toggleEl) toggleEl.addEventListener('change', (e) => {
            wifiEnabled = e.target.checked;
            renderList();
            updateTrayIcon();
        });

        if (scanBtn) scanBtn.addEventListener('click', () => {
            if (!wifiEnabled || scanning) return;
            scan();
        });

        if (pwdCancelBtn) pwdCancelBtn.addEventListener('click', closePwdModal);
        if (pwdConnectBtn) pwdConnectBtn.addEventListener('click', submitPassword);
        if (pwdInput) {
            pwdInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') submitPassword();
            });
            pwdInput.addEventListener('input', () => {
                pwdInput.style.borderColor = '#30363d';
            });
        }
    }

    async function scan() {
        scanning = true;
        scanBtn.classList.add('spinning');
        listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: #8b949e;">Scanning for networks...</div>`;
        
        try {
            const data = await apiCommand('wifi_scan', {}).catch(() => null);
            if (data && data.stdout) {
                const parsed = JSON.parse(data.stdout);
                
                // Preserve connected state if any
                const connectedNet = networks.find(n => n.connected);
                networks = parsed;
                if (connectedNet) {
                    const match = networks.find(n => n.ssid === connectedNet.ssid);
                    if (match) match.connected = true;
                    else networks.push(connectedNet); // Keep it around if it disappeared
                }
            }
        } catch (e) {
            console.error('Wi-Fi scan failed', e);
        }
        
        scanning = false;
        scanBtn.classList.remove('spinning');
        
        if (networks.length === 0) {
            listEl.innerHTML = `<div style="padding: 30px 20px; text-align: center; color: #8b949e;">
                <i class="fa-solid fa-satellite-dish" style="font-size: 2rem; margin-bottom: 15px; opacity: 0.3;"></i>
                <div>No Wi-Fi interfaces or networks found</div>
            </div>`;
        } else {
            renderList();
        }
    }

    function renderList() {
        if (!wifiEnabled) {
            listEl.innerHTML = `<div style="padding: 30px 20px; text-align: center; color: #8b949e;">
                <i class="fa-solid fa-wifi" style="font-size: 2rem; margin-bottom: 15px; opacity: 0.3;"></i>
                <div>Wi-Fi is turned off</div>
            </div>`;
            return;
        }

        listEl.innerHTML = '';
        
        // Sort connected first
        const sorted = [...networks].sort((a, b) => b.connected - a.connected);

        sorted.forEach(net => {
            const item = document.createElement('div');
            item.className = `wifi-item ${net.connected ? 'connected' : ''}`;
            
            // Security lock
            const lockHtml = net.sec !== 'Open' ? `<i class="fa-solid fa-lock wifi-security" style="position:absolute; right: -5px; bottom: 0; font-size: 0.55rem; background: ${net.connected ? '#3b82f6' : '#21262d'}; border-radius: 50%; padding: 2px;"></i>` : '';

            const btnHtml = net.connected 
                ? `<button class="wifi-action-btn" onclick="WIFI.disconnect('${net.id}', event)">Disconnect</button>`
                : `<button class="wifi-action-btn" onclick="WIFI.connect('${net.id}', event)">Connect</button>`;

            item.innerHTML = `
                <div class="wifi-icon-wrap" style="position:relative;">
                    <i class="fa-solid fa-wifi"></i>
                    ${lockHtml}
                </div>
                <div class="wifi-info">
                    <div class="wifi-name">${net.ssid}</div>
                    <div class="wifi-status">${net.connected ? 'Connected, secured' : net.sec}</div>
                </div>
                ${btnHtml}
            `;

            // If not connected and click anywhere, show connect, if connected show details
            item.onclick = (e) => {
                if (!net.connected && e.target.tagName !== 'BUTTON') {
                    connect(net.id, e);
                } else if (net.connected && e.target.tagName !== 'BUTTON') {
                    showDetails(net);
                }
            };

            listEl.appendChild(item);
        });
    }

    function showDetails(net) {
        let detailsOverlay = document.getElementById('wifi-details-overlay');
        if (!detailsOverlay) {
            detailsOverlay = document.createElement('div');
            detailsOverlay.id = 'wifi-details-overlay';
            detailsOverlay.className = 'wifi-pwd-overlay';
            document.querySelector('.window-body.wifi-theme').appendChild(detailsOverlay);
        }
        
        detailsOverlay.innerHTML = `
            <div class="wifi-pwd-modal">
                <h4 style="margin-top:0; color:#e6edf3; font-weight:600; margin-bottom:15px;">Network Properties</h4>
                <div style="font-size: 0.85rem; color: #8b949e; display: flex; flex-direction: column; gap: 8px;">
                    <div style="display:flex; justify-content:space-between;"><span>SSID:</span> <span style="color:#c9d1d9;font-weight:500;">${net.ssid}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span>Security:</span> <span style="color:#c9d1d9;font-weight:500;">${net.sec}</span></div>
                    <div style="display:flex; justify-content:space-between;"><span>Signal Strength:</span> <span style="color:#c9d1d9;font-weight:500;">${net.strength}/4 bars</span></div>
                    <div style="display:flex; justify-content:space-between;"><span>Status:</span> <span style="color:#3b82f6;font-weight:600;">${net.connected ? 'Connected' : 'Disconnected'}</span></div>
                </div>
                <div class="wifi-pwd-actions" style="margin-top: 20px;">
                    <button class="fm-btn" onclick="document.getElementById('wifi-details-overlay').style.display='none'" style="width:100%; background:#21262d; border-color:#30363d; color:#c9d1d9;">Close</button>
                </div>
            </div>
        `;
        detailsOverlay.style.display = 'flex';
    }

    function connect(id, event) {
        if (event) event.stopPropagation();
        const net = networks.find(n => n.id === id);
        if (!net) return;

        if (net.sec === 'Open') {
            executeConnect(id);
        } else {
            pendingConnectId = id;
            pwdTitle.textContent = `Connect to ${net.ssid}`;
            pwdInput.value = '';
            pwdOverlay.style.display = 'flex';
            setTimeout(() => pwdInput.focus(), 100);
        }
    }

    function disconnect(id, event) {
        if (event) event.stopPropagation();
        const net = networks.find(n => n.id === id);
        if (net) {
            net.connected = false;
            renderList();
            updateTrayIcon();
        }
    }

    function closePwdModal() {
        pwdOverlay.style.display = 'none';
        pendingConnectId = null;
    }

    function submitPassword() {
        if (!pwdInput.value) {
            pwdInput.style.borderColor = '#ef4444';
            return;
        }
        const idToConnect = pendingConnectId;
        closePwdModal();
        executeConnect(idToConnect);
    }

    async function executeConnect(id) {
        const net = networks.find(n => n.id === id);
        if (!net) return;

        // Show connecting state
        renderList(); // reset
        const items = listEl.querySelectorAll('.wifi-item');
        const idx = [...networks].sort((a,b)=>b.connected-a.connected).findIndex(n => n.id === id);
        if (items[idx]) {
            const btn = items[idx].querySelector('.wifi-action-btn');
            if (btn) {
                btn.style.display = 'block';
                btn.className = 'wifi-action-btn connecting';
                btn.textContent = 'Connecting...';
            }
        }

        try {
            const res = await apiCommand('wifi_connect', { 
                ssid: net.ssid, 
                password: pwdInput.value 
            });
            
            if (res.exit_code === 0) {
                networks.forEach(n => n.connected = false); // disconnect others
                net.connected = true;
                if (typeof showToast !== 'undefined') showToast(`Connected to ${net.ssid}`);
            } else {
                let errMsg = res.stderr || res.stdout || 'Unknown error';
                try {
                    let j = JSON.parse(res.stdout);
                    if (j.error) errMsg = j.error;
                } catch(e) {}
                if (typeof showToast !== 'undefined') showToast(`Failed to connect: ${errMsg}`);
            }
        } catch (e) {
            if (typeof showToast !== 'undefined') showToast(`Connection error: ${e.message}`);
        }
        
        renderList();
        updateTrayIcon();
    }

    function updateTrayIcon() {
        if (!trayIcon) return;
        if (!wifiEnabled) {
            trayIcon.innerHTML = `<i class="fa-solid fa-wifi" style="opacity: 0.3;"></i>`;
            trayIcon.style.color = 'var(--text-secondary)';
        } else {
            const hasConnection = networks.some(n => n.connected);
            if (hasConnection) {
                trayIcon.innerHTML = `<i class="fa-solid fa-wifi"></i>`;
                trayIcon.style.color = '#e6edf3';
            } else {
                trayIcon.innerHTML = `<i class="fa-solid fa-wifi" style="opacity: 0.6;"></i> <span style="position:absolute; bottom:2px; right:-2px; font-size:0.5rem; color:#ef4444;"><i class="fa-solid fa-circle-exclamation"></i></span>`;
                trayIcon.style.color = 'var(--text-secondary)';
            }
        }
    }

    return { init, connect, disconnect };
})();

// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(WIFI.init, 500);
});
