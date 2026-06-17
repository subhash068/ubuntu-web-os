// AWS Console Application Logic
let awsConfig = {
    boto3_installed: false,
    has_credentials: false,
    aws_access_key_id: '',
    aws_default_region: 'us-east-1',
    connected: false,
    arn: '',
    mode: 'demo' // 'demo' or 'real'
};

let awsResources = null;
let awsActiveTab = 'overview';
let awsFailoverProgress = false;

// Register AWS Window in global desktop environment
if (typeof windows !== 'undefined') {
    windows['aws'] = {
        title: 'AWS DevOps Console',
        id: 'aws',
        min: false,
        max: false,
        active: false
    };
}

// Hook into Ubuntu Web OS window activation
document.addEventListener('DOMContentLoaded', () => {
    // Check if AWS app icon exists or needs setup
    const awsIcon = document.getElementById('shortcut-aws') || document.querySelector('.start-menu-item[onclick*="aws"]');
    if (awsIcon) {
        // Intercept or register open behavior
        const oldOpen = window.openWindow;
        window.openWindow = function(winId) {
            oldOpen(winId);
            if (winId === 'aws') {
                initAWSApp();
            }
        };
    }
});

async function initAWSApp() {
    showAwsLoading(true);
    try {
        // Get AWS Configuration on server
        const configRes = await apiCommand('aws_get_config');
        awsConfig.boto3_installed = configRes.boto3_installed;
        awsConfig.has_credentials = configRes.has_credentials;
        awsConfig.aws_access_key_id = configRes.aws_access_key_id;
        awsConfig.aws_default_region = configRes.aws_default_region;
        
        // Update credentials setup form UI
        document.getElementById('aws-input-key').value = '';
        document.getElementById('aws-input-secret').value = '';
        document.getElementById('aws-input-region').value = awsConfig.aws_default_region;
        
        if (awsConfig.has_credentials) {
            document.getElementById('aws-masked-key').innerText = `Configured Access Key: ${awsConfig.aws_access_key_id}`;
            // Test connection
            const connRes = await apiCommand('aws_test_connection');
            if (connRes.connected) {
                awsConfig.connected = true;
                awsConfig.arn = connRes.arn;
                awsConfig.mode = 'real';
            } else {
                awsConfig.connected = false;
                awsConfig.mode = 'demo'; // Fallback to demo mode
                showAwsToast(`AWS API Connect failed. Using Demo Mode. Error: ${connRes.error}`, 'warning');
            }
        } else {
            awsConfig.connected = false;
            awsConfig.mode = 'demo';
        }
        
        // Load resources
        await refreshAwsData();
        
        // Select correct default tab
        if (!awsConfig.has_credentials) {
            switchAwsTab('settings');
        } else {
            switchAwsTab('overview');
        }
    } catch (e) {
        console.error("Error initializing AWS app:", e);
        awsConfig.mode = 'demo';
        await loadMockAwsResources();
        switchAwsTab('overview');
    } finally {
        showAwsLoading(false);
    }
}

function showAwsLoading(show) {
    const loader = document.getElementById('aws-loader');
    if (loader) loader.style.display = show ? 'flex' : 'none';
}

function showAwsToast(msg, type = 'info') {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.innerText = msg;
        toast.style.background = type === 'warning' ? '#f59e0b' : type === 'error' ? '#ef4444' : '#10b981';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 4000);
    }
}

async function refreshAwsData() {
    showAwsLoading(true);
    try {
        const res = await apiCommand('aws_get_resources', { region: awsConfig.aws_default_region });
        if (res.error) {
            console.warn("Error getting real AWS resources, falling back to mock:", res.error);
            showAwsToast("Real API failed. Falling back to Demo Mode.", "warning");
        }
        awsResources = res;
        awsConfig.mode = res.mode || 'demo';
        
        // Update connection badges
        updateAwsBadges();
        
        // Redraw current view
        renderActiveAwsView();
    } catch (e) {
        console.error("Failed to fetch AWS resources:", e);
        await loadMockAwsResources();
    } finally {
        showAwsLoading(false);
    }
}

async function loadMockAwsResources() {
    // Load mock database entries directly
    awsConfig.mode = 'demo';
    awsResources = {
        mode: 'demo',
        region: awsConfig.aws_default_region || 'us-east-1',
        vpc_data: {
            vpcs: [{'id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.0.0/16', 'is_default': False}],
            subnets: [
                {'id': 'subnet-public-1a', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.1.0/24', 'az': 'us-east-1a', 'public': true},
                {'id': 'subnet-public-1b', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.2.0/24', 'az': 'us-east-1b', 'public': true},
                {'id': 'subnet-public-1c', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.3.0/24', 'az': 'us-east-1c', 'public': true},
                {'id': 'subnet-private-1a', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.10.0/24', 'az': 'us-east-1a', 'public': false},
                {'id': 'subnet-private-1b', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.20.0/24', 'az': 'us-east-1b', 'public': false},
                {'id': 'subnet-private-1c', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.30.0/24', 'az': 'us-east-1c', 'public': false}
            ],
            nats: [
                {'id': 'nat-0a1b2c3d', 'status': 'Available', 'az': 'us-east-1a'},
                {'id': 'nat-0e5f6g7h', 'status': 'Available', 'az': 'us-east-1b'},
                {'id': 'nat-0i8j9k0l', 'status': 'Available', 'az': 'us-east-1c'}
            ]
        },
        eks_clusters: [{
            name: 'eks-production-cluster',
            status: 'ACTIVE',
            version: '1.30.0',
            endpoint: 'https://A1B2C3D4E5F6G7H8.gr7.us-east-1.eks.amazonaws.com'
        }],
        db_clusters: [{
            id: 'rds-postgres-prod-cluster',
            engine: 'aurora-postgresql',
            status: 'available',
            endpoint: 'rds-postgres-prod.cluster-ro-xyz.us-east-1.rds.amazonaws.com',
            members: [
                {id: 'rds-db-replica-1', role: 'Reader', az: 'us-east-1a', status: 'Active'},
                {id: 'rds-db-primary', role: 'Primary', az: 'us-east-1b', status: 'Active'},
                {id: 'rds-db-replica-2', role: 'Reader', az: 'us-east-1c', status: 'Active'}
            ]
        }],
        dns_zones: [{
            name: 'webos.dev.',
            id: '/hostedzone/Z0123456789ABCDEF',
            record_count: 4,
            records: [
                {name: 'webos.dev.', type: 'A', ttl: 300, value: ['34.200.45.12']},
                {name: 'api.webos.dev.', type: 'CNAME', 'ttl': 60, value: ['eks-production-elb-123456.us-east-1.elb.amazonaws.com']},
                {name: 'redis.webos.dev.', type: 'A', ttl: 300, value: ['10.0.10.45']},
                {name: 'ns.webos.dev.', type: 'NS', ttl: 172800, value: ['ns-2048.awsdns-64.com', 'ns-2049.awsdns-65.net']}
            ]
        }],
        ecr_repos: [
            {
                name: 'ubuntu-webos-app',
                uri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/ubuntu-webos-app',
                images: [
                    {tag: 'latest', digest: 'sha256:abcd1234efgh5678', pushed: '2026-06-16 12:45:00'},
                    {tag: 'v1.2.0', digest: 'sha256:1234567890abcdef', pushed: '2026-06-15 08:30:00'}
                ]
            }
        ]
    };
    updateAwsBadges();
    renderActiveAwsView();
}

function updateAwsBadges() {
    const badge = document.getElementById('aws-connection-badge');
    if (!badge) return;
    
    if (awsConfig.mode === 'real' && awsConfig.connected) {
        badge.className = 'aws-badge aws-badge-connected';
        badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Connected (AWS Real)`;
        badge.title = awsConfig.arn;
    } else {
        badge.className = 'aws-badge aws-badge-demo';
        badge.innerHTML = `<i class="fa-solid fa-flask"></i> AWS Demo Mode`;
        badge.title = 'Running locally on simulated AWS cluster';
    }
}

function switchAwsTab(tabId) {
    awsActiveTab = tabId;
    
    // Toggle active sidebar item
    document.querySelectorAll('.aws-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const activeItem = document.getElementById(`aws-menu-${tabId}`);
    if (activeItem) activeItem.classList.add('active');
    
    // Switch active view container
    document.querySelectorAll('.aws-view').forEach(view => {
        view.classList.remove('active');
    });
    
    const activeView = document.getElementById(`aws-view-${tabId}`);
    if (activeView) activeView.classList.add('active');
    
    renderActiveAwsView();
}

function renderActiveAwsView() {
    if (!awsResources) return;
    
    switch (awsActiveTab) {
        case 'overview':
            renderAwsOverview();
            break;
        case 'route53':
            renderAwsRoute53();
            break;
        case 'eks':
            renderAwsEks();
            break;
        case 'rds':
            renderAwsRds();
            break;
        case 'ecr':
            renderAwsEcr();
            break;
        case 'observability':
            renderAwsObservability();
            break;
    }
}

// ---------------- RENDER 1: OVERVIEW TOPOLOGY MAP ----------------
function renderAwsOverview() {
    const container = document.getElementById('aws-topology-map');
    if (!container) return;
    
    // Renders the topology using standard SVGs
    // Find active primary DB AZ
    let primaryAz = 'us-east-1b';
    if (awsResources.db_clusters && awsResources.db_clusters.length > 0) {
        const members = awsResources.db_clusters[0].members || [];
        const primary = members.find(m => m.role === 'Primary');
        if (primary) primaryAz = primary.az;
    }
    
    // VPC and AZ boxes mapping
    container.innerHTML = `
        <svg class="aws-svg-canvas" viewBox="0 0 820 490" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <!-- Gradients -->
                <linearGradient id="vpcGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#0a1b3a" stop-opacity="0.2"/>
                    <stop offset="100%" stop-color="#050e1e" stop-opacity="0.4"/>
                </linearGradient>
                <linearGradient id="orangeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#ff9900"/>
                    <stop offset="100%" stop-color="#e68a00"/>
                </linearGradient>
                <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#248bfb"/>
                    <stop offset="100%" stop-color="#016fd8"/>
                </linearGradient>
                <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#10b981"/>
                    <stop offset="100%" stop-color="#059669"/>
                </linearGradient>
            </defs>

            <!-- Global Route 53 Gateway -->
            <g class="topo-node" onclick="switchAwsTab('route53')">
                <rect x="360" y="10" width="100" height="36" rx="6" fill="#1b223c" stroke="var(--aws-color-primary)" stroke-width="1"/>
                <text x="410" y="24" fill="#fff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">Amazon Route 53</text>
                <text x="410" y="38" fill="var(--aws-text-muted)" font-size="8" font-family="sans-serif" text-anchor="middle">webos.dev</text>
            </g>

            <!-- VPC Container -->
            <rect x="20" y="65" width="780" height="400" rx="10" fill="url(#vpcGrad)" stroke="#3b82f6" stroke-width="1.5" />
            <text x="35" y="85" fill="#3b82f6" font-size="11" font-family="sans-serif" font-weight="bold">VPC (10.0.0.0/16)</text>
            
            <!-- Internet Gateway -->
            <g class="topo-node">
                <circle cx="410" cy="65" r="14" fill="#232f3e" stroke="#3b82f6" stroke-width="1.5"/>
                <path d="M 405,65 L 415,65 M 410,60 L 410,70" stroke="#fff" stroke-width="2"/>
                <text x="410" y="88" fill="#fff" font-size="8" font-family="sans-serif" text-anchor="middle">IGW</text>
            </g>

            <!-- 3 Availability Zones -->
            <!-- AZ 1 -->
            <rect x="40" y="110" width="230" height="330" rx="8" class="topo-zone-border" />
            <text x="50" y="125" fill="var(--aws-text-muted)" font-size="9" font-family="sans-serif" font-weight="bold">Availability Zone 1 (us-east-1a)</text>

            <!-- AZ 2 -->
            <rect x="295" y="110" width="230" height="330" rx="8" class="topo-zone-border" />
            <text x="305" y="125" fill="var(--aws-text-muted)" font-size="9" font-family="sans-serif" font-weight="bold">Availability Zone 2 (us-east-1b)</text>

            <!-- AZ 3 -->
            <rect x="550" y="110" width="230" height="330" rx="8" class="topo-zone-border" />
            <text x="560" y="125" fill="var(--aws-text-muted)" font-size="9" font-family="sans-serif" font-weight="bold">Availability Zone 3 (us-east-1c)</text>

            <!-- Subnets inside AZs -->
            <!-- AZ 1 Public -->
            <rect x="50" y="140" width="210" height="100" rx="6" class="topo-subnet-public" />
            <text x="60" y="153" fill="#10b981" font-size="8" font-family="sans-serif" font-weight="bold">Public Subnet (10.0.1.0/24)</text>
            <!-- NAT 1 -->
            <g class="topo-node" onclick="showNodeDetails('NAT Gateway 1', 'Subnet: public-1a\\nIP: 10.0.1.12\\nStatus: Available')">
                <rect x="70" y="170" width="170" height="50" rx="4" fill="#0f172a" stroke="rgba(16, 185, 129, 0.4)" stroke-width="1"/>
                <text x="155" y="190" fill="#fff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">AWS NAT Gateway</text>
                <text x="155" y="205" fill="#10b981" font-size="8" font-family="sans-serif" text-anchor="middle">nat-01 [Available]</text>
            </g>

            <!-- AZ 2 Public -->
            <rect x="305" y="140" width="210" height="100" rx="6" class="topo-subnet-public" />
            <text x="315" y="153" fill="#10b981" font-size="8" font-family="sans-serif" font-weight="bold">Public Subnet (10.0.2.0/24)</text>
            <!-- NAT 2 -->
            <g class="topo-node" onclick="showNodeDetails('NAT Gateway 2', 'Subnet: public-1b\\nIP: 10.0.2.45\\nStatus: Available')">
                <rect x="325" y="170" width="170" height="50" rx="4" fill="#0f172a" stroke="rgba(16, 185, 129, 0.4)" stroke-width="1"/>
                <text x="410" y="190" fill="#fff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">AWS NAT Gateway</text>
                <text x="410" y="205" fill="#10b981" font-size="8" font-family="sans-serif" text-anchor="middle">nat-02 [Available]</text>
            </g>

            <!-- AZ 3 Public -->
            <rect x="560" y="140" width="210" height="100" rx="6" class="topo-subnet-public" />
            <text x="570" y="153" fill="#10b981" font-size="8" font-family="sans-serif" font-weight="bold">Public Subnet (10.0.3.0/24)</text>
            <!-- NAT 3 -->
            <g class="topo-node" onclick="showNodeDetails('NAT Gateway 3', 'Subnet: public-1c\\nIP: 10.0.3.99\\nStatus: Available')">
                <rect x="580" y="170" width="170" height="50" rx="4" fill="#0f172a" stroke="rgba(16, 185, 129, 0.4)" stroke-width="1"/>
                <text x="665" y="190" fill="#fff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">AWS NAT Gateway</text>
                <text x="665" y="205" fill="#10b981" font-size="8" font-family="sans-serif" text-anchor="middle">nat-03 [Available]</text>
            </g>

            <!-- AZ 1 Private -->
            <rect x="50" y="255" width="210" height="170" rx="6" class="topo-subnet-private" />
            <text x="60" y="268" fill="var(--aws-color-accent)" font-size="8" font-family="sans-serif" font-weight="bold">Private Subnet (10.0.10.0/24)</text>
            <!-- EC2 Worker Node 1 -->
            <g class="topo-node" onclick="switchAwsTab('eks')">
                <rect x="65" y="280" width="180" height="55" rx="4" fill="#111827" stroke="rgba(36, 139, 251, 0.4)" stroke-width="1"/>
                <text x="155" y="296" fill="#fff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">EC2 Worker Node</text>
                <text x="155" y="310" fill="var(--aws-text-muted)" font-size="8" font-family="sans-serif" text-anchor="middle">Instance: i-01a2b3c4d5e6</text>
                <text x="155" y="323" fill="#10b981" font-size="8" font-family="sans-serif" text-anchor="middle">Status: Ready (EBS: 100GiB)</text>
            </g>
            <!-- RDS Standby 1 -->
            <g class="topo-node" onclick="switchAwsTab('rds')">
                <rect x="65" y="355" width="180" height="55" rx="4" fill="#111827" stroke="${primaryAz === 'us-east-1a' ? 'var(--aws-color-primary)' : 'rgba(255, 255, 255, 0.15)'}" stroke-width="1.5"/>
                <text x="155" y="371" fill="#fff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">RDS PostgreSQL DB</text>
                <text x="155" y="385" fill="var(--aws-text-muted)" font-size="8" font-family="sans-serif" text-anchor="middle">rds-db-replica-1</text>
                <text x="155" y="398" fill="${primaryAz === 'us-east-1a' ? 'var(--aws-color-primary)' : '#3b82f6'}" font-size="8" font-family="sans-serif" text-anchor="middle" font-weight="bold">Role: ${primaryAz === 'us-east-1a' ? 'Primary' : 'Reader (Replica)'}</text>
            </g>

            <!-- AZ 2 Private -->
            <rect x="305" y="255" width="210" height="170" rx="6" class="topo-subnet-private" />
            <text x="315" y="268" fill="var(--aws-color-accent)" font-size="8" font-family="sans-serif" font-weight="bold">Private Subnet (10.0.20.0/24)</text>
            <!-- EKS Master / Ingress -->
            <g class="topo-node" onclick="switchAwsTab('eks')">
                <rect x="320" y="280" width="180" height="55" rx="4" fill="#111827" stroke="rgba(36, 139, 251, 0.4)" stroke-width="1"/>
                <text x="410" y="296" fill="#fff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">EKS Control Plane</text>
                <text x="410" y="310" fill="var(--aws-text-muted)" font-size="8" font-family="sans-serif" text-anchor="middle">eks-production-cluster</text>
                <text x="410" y="323" fill="#ff9900" font-size="8" font-family="sans-serif" text-anchor="middle">Ingress Controller: Active</text>
            </g>
            <!-- RDS Primary/Standby 2 -->
            <g class="topo-node" onclick="switchAwsTab('rds')">
                <rect x="320" y="355" width="180" height="55" rx="4" fill="#111827" stroke="${primaryAz === 'us-east-1b' ? 'var(--aws-color-primary)' : 'rgba(255, 255, 255, 0.15)'}" stroke-width="1.5"/>
                <text x="410" y="371" fill="#fff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">RDS PostgreSQL DB</text>
                <text x="410" y="385" fill="var(--aws-text-muted)" font-size="8" font-family="sans-serif" text-anchor="middle">rds-db-primary</text>
                <text x="410" y="398" fill="${primaryAz === 'us-east-1b' ? 'var(--aws-color-primary)' : '#3b82f6'}" font-size="8" font-family="sans-serif" text-anchor="middle" font-weight="bold">Role: ${primaryAz === 'us-east-1b' ? 'Primary' : 'Reader (Replica)'}</text>
            </g>

            <!-- AZ 3 Private -->
            <rect x="560" y="255" width="210" height="170" rx="6" class="topo-subnet-private" />
            <text x="570" y="268" fill="var(--aws-color-accent)" font-size="8" font-family="sans-serif" font-weight="bold">Private Subnet (10.0.30.0/24)</text>
            <!-- EC2 Worker Node 2 -->
            <g class="topo-node" onclick="switchAwsTab('eks')">
                <rect x="575" y="280" width="180" height="55" rx="4" fill="#111827" stroke="rgba(36, 139, 251, 0.4)" stroke-width="1"/>
                <text x="665" y="296" fill="#fff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">EC2 Worker Node</text>
                <text x="665" y="310" fill="var(--aws-text-muted)" font-size="8" font-family="sans-serif" text-anchor="middle">Instance: i-07a8b9c0d1e2</text>
                <text x="665" y="323" fill="#10b981" font-size="8" font-family="sans-serif" text-anchor="middle">Status: Ready (EBS: 100GiB)</text>
            </g>
            <!-- RDS Standby 3 -->
            <g class="topo-node" onclick="switchAwsTab('rds')">
                <rect x="575" y="355" width="180" height="55" rx="4" fill="#111827" stroke="${primaryAz === 'us-east-1c' ? 'var(--aws-color-primary)' : 'rgba(255, 255, 255, 0.15)'}" stroke-width="1.5"/>
                <text x="665" y="371" fill="#fff" font-size="10" font-family="sans-serif" text-anchor="middle" font-weight="bold">RDS PostgreSQL DB</text>
                <text x="665" y="385" fill="var(--aws-text-muted)" font-size="8" font-family="sans-serif" text-anchor="middle">rds-db-replica-2</text>
                <text x="665" y="398" fill="${primaryAz === 'us-east-1c' ? 'var(--aws-color-primary)' : '#3b82f6'}" font-size="8" font-family="sans-serif" text-anchor="middle" font-weight="bold">Role: ${primaryAz === 'us-east-1c' ? 'Primary' : 'Reader (Replica)'}</text>
            </g>

            <!-- Dynamic Traffic Connections -->
            <path d="M 410,46 L 410,51" class="topo-connection-line"/>
            <path d="M 410,79 L 410,140" class="topo-connection-line"/>
            <!-- Routing to Ingress -->
            <path d="M 410,240 L 410,280" class="topo-connection-line" stroke-dasharray="3 3"/>
            <!-- Ingress Routing to Worker Nodes -->
            <path d="M 320,305 L 245,305" class="topo-connection-line"/>
            <path d="M 500,305 L 575,305" class="topo-connection-line"/>
            <!-- DB Replication Streams -->
            <path d="M 320,382 L 245,382" class="topo-connection-line" stroke="#ff9900" stroke-width="1"/>
            <path d="M 500,382 L 575,382" class="topo-connection-line" stroke="#ff9900" stroke-width="1"/>
        </svg>

        <!-- Tooltip/Details Card Overlay -->
        <div id="aws-topo-details" style="position: absolute; bottom: 20px; right: 20px; width: 240px; background: rgba(11,14,27,0.9); border: 1px solid rgba(255,255,255,0.08); padding: 12px; border-radius: 8px; font-size: 0.75rem; color: #fff; pointer-events: none; display: none;">
            <div id="aws-details-title" style="font-weight: bold; color: var(--aws-color-primary); border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 4px; margin-bottom: 6px;">Resource</div>
            <div id="aws-details-body" style="white-space: pre-line; line-height: 1.4;">Info...</div>
        </div>
    `;
}

function showNodeDetails(title, info) {
    const box = document.getElementById('aws-topo-details');
    const tEl = document.getElementById('aws-details-title');
    const bEl = document.getElementById('aws-details-body');
    if (!box) return;
    
    tEl.innerText = title;
    bEl.innerText = info;
    box.style.display = 'block';
    
    // Auto-hide after 5 seconds
    if (window.topoDetailTimeout) clearTimeout(window.topoDetailTimeout);
    window.topoDetailTimeout = setTimeout(() => {
        box.style.display = 'none';
    }, 5000);
}

// ---------------- RENDER 2: ROUTE 53 DNS RECORDS ----------------
function renderAwsRoute53() {
    const list = document.getElementById('aws-dns-list');
    if (!list) return;
    
    if (!awsResources.dns_zones || awsResources.dns_zones.length === 0) {
        list.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--aws-text-muted); padding: 20px;">No Hosted Zones configured in this region.</td></tr>`;
        return;
    }
    
    let rows = '';
    awsResources.dns_zones.forEach(zone => {
        zone.records.forEach(rec => {
            rows += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <td style="padding: 10px 16px; font-weight: 500;">${rec.name}</td>
                    <td style="padding: 10px 16px; color: var(--aws-color-primary); font-weight: 600;">${rec.type}</td>
                    <td style="padding: 10px 16px; color: var(--aws-text-muted);">${rec.ttl}s</td>
                    <td style="padding: 10px 16px; font-family: var(--font-mono); font-size: 0.75rem;">${rec.value.join(', ')}</td>
                </tr>
            `;
        });
    });
    list.innerHTML = rows;
}

// ---------------- RENDER 3: EKS CLUSTERS ----------------
function renderAwsEks() {
    const body = document.getElementById('aws-eks-list');
    if (!body) return;
    
    if (!awsResources.eks_clusters || awsResources.eks_clusters.length === 0) {
        body.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--aws-text-muted); padding: 20px;">No active EKS clusters found.</td></tr>`;
        return;
    }
    
    let rows = '';
    awsResources.eks_clusters.forEach(c => {
        rows += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                <td style="padding: 12px 16px; font-weight: 600;">${c.name}</td>
                <td style="padding: 12px 16px;"><span class="aws-badge aws-badge-connected" style="background: rgba(16,185,129,0.1); color: #10b981;">${c.status}</span></td>
                <td style="padding: 12px 16px; color: var(--aws-text-muted);">Kubernetes v${c.version}</td>
                <td style="padding: 12px 16px; font-family: var(--font-mono); font-size: 0.72rem; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.endpoint}</td>
                <td style="padding: 12px 16px; text-align: right;">
                    <button class="fm-btn" onclick="openKubernativesDashboard()" style="background: rgba(50,108,229,0.15); border-color: rgba(50,108,229,0.3); color: #326ce5; font-size: 0.72rem; padding: 4px 8px; flex: none;">
                        <i class="fa-solid fa-dharmachakra"></i> Open Kubernatives
                    </button>
                </td>
            </tr>
        `;
    });
    body.innerHTML = rows;
}

function openKubernativesDashboard() {
    if (typeof openWindow !== 'undefined') {
        openWindow('kubernetes');
    }
}

// ---------------- RENDER 4: RDS DB CLUSTERS ----------------
function renderAwsRds() {
    const list = document.getElementById('aws-rds-list');
    if (!list) return;
    
    if (!awsResources.db_clusters || awsResources.db_clusters.length === 0) {
        list.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--aws-text-muted); padding: 20px;">No RDS Clusters deployed.</td></tr>`;
        return;
    }
    
    let rows = '';
    awsResources.db_clusters.forEach(db => {
        db.members.forEach(m => {
            rows += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <td style="padding: 10px 16px; font-weight: bold;">${m.id}</td>
                    <td style="padding: 10px 16px; color: var(--aws-text-muted); text-transform: capitalize;">${db.engine}</td>
                    <td style="padding: 10px 16px;">
                        <span class="aws-badge" style="background: ${m.role === 'Primary' ? 'rgba(255,153,0,0.15)' : 'rgba(36,139,251,0.12)'}; color: ${m.role === 'Primary' ? 'var(--aws-color-primary)' : 'var(--aws-color-accent)'}; border: 1px solid ${m.role === 'Primary' ? 'rgba(255,153,0,0.25)' : 'rgba(36,139,251,0.25)'};">
                            ${m.role}
                        </span>
                    </td>
                    <td style="padding: 10px 16px; color: var(--aws-text-muted);">${m.az}</td>
                    <td style="padding: 10px 16px;"><span class="aws-badge aws-badge-connected" style="background: rgba(16,185,129,0.1); color: #10b981;">Available</span></td>
                </tr>
            `;
        });
    });
    list.innerHTML = rows;
}

async function triggerRdsFailover() {
    if (awsFailoverProgress) return;
    
    awsFailoverProgress = true;
    const btn = document.getElementById('aws-btn-failover');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Promoting Standby Replica...`;
    }
    
    try {
        const res = await apiCommand('aws_failover_db');
        if (res.success) {
            showAwsToast(res.msg, 'success');
            // Refresh local or pull resources
            await refreshAwsData();
        } else {
            showAwsToast(`Failover failed: ${res.error}`, 'error');
        }
    } catch (e) {
        showAwsToast("Failover API invocation error", 'error');
    } finally {
        awsFailoverProgress = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-shuffle"></i> Failover primary instance`;
        }
    }
}

// ---------------- RENDER 5: ECR REPOSITORIES ----------------
function renderAwsEcr() {
    const list = document.getElementById('aws-ecr-list');
    if (!list) return;
    
    if (!awsResources.ecr_repos || awsResources.ecr_repos.length === 0) {
        list.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--aws-text-muted); padding: 20px;">No ECR container repositories.</td></tr>`;
        return;
    }
    
    let rows = '';
    awsResources.ecr_repos.forEach(repo => {
        repo.images.forEach(img => {
            rows += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <td style="padding: 10px 16px; font-weight: bold;">${repo.name}</td>
                    <td style="padding: 10px 16px; font-family: var(--font-mono); font-size: 0.72rem; color: var(--aws-color-accent);">${img.tag}</td>
                    <td style="padding: 10px 16px; font-family: var(--font-mono); font-size: 0.7rem; color: var(--aws-text-muted);">${img.digest}</td>
                    <td style="padding: 10px 16px; font-size: 0.75rem; color: var(--aws-text-muted);">${img.pushed}</td>
                </tr>
            `;
        });
    });
    list.innerHTML = rows;
}

// ---------------- RENDER 6: OBSERVABILITY LOGS & PIPELINE ----------------
let awsLogLines = [
    "[INFO] Initializing AWS DevOps Deployment Agent daemon...",
    "[INFO] Tailing Amazon CloudWatch logs for log-group: /aws/eks/prod-cluster/cluster",
    "[INFO] Prometheus metrics server active at endpoint /metrics",
    "[METRIC] CPU Utilization: 14.5% | Memory: 32.1GiB / 64GiB Ready",
    "[SYS] NAT Gateway nat-0a1b2c3d bandwidth peak: 450Mbps",
    "[RDS] PostgreSQL replica replication lag: 22ms"
];

function renderAwsObservability() {
    const panel = document.getElementById('aws-logs-console');
    if (!panel) return;
    
    // Print lines
    let html = '';
    awsLogLines.forEach(line => {
        const timeStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const color = line.includes('[INFO]') ? '#e2e8f0' : line.includes('[METRIC]') ? '#88c0d0' : line.includes('[WARN]') ? '#f59e0b' : '#34d399';
        html += `
            <div class="aws-log-line">
                <span class="aws-log-time">${timeStr}</span>
                <span style="color: ${color};">${line}</span>
            </div>
        `;
    });
    panel.innerHTML = html;
    panel.scrollTop = panel.scrollHeight;
}

function triggerDevOpsPipeline() {
    const btn = document.getElementById('aws-btn-pipeline');
    if (btn) btn.disabled = true;
    
    let pipelineSteps = [
        "[PIPELINE] Starting Build Pipeline Run #4512...",
        "[PIPELINE] Fetching git branch 'main' of ubuntu-webos-app repository...",
        "[PIPELINE] Running docker build -t ubuntu-webos-app:latest . ...",
        "[PIPELINE] Docker image compiled successfully (size: 245MB)",
        "[PIPELINE] Authenticating with AWS ECR registry...",
        "[PIPELINE] Pushing tag 'latest' to ECR repository '123456789012.dkr.ecr.us-east-1.amazonaws.com/ubuntu-webos-app'...",
        "[PIPELINE] Push complete! Digest: sha256:abcd1234efgh5678",
        "[PIPELINE] Connecting to EKS Control Plane 'eks-production-cluster'...",
        "[PIPELINE] Rolling update deployment 'webos-deployment' with new image tag...",
        "[PIPELINE] Kubernetes replica sync completed! 3 replicas online.",
        "[PIPELINE] Pipeline finished successfully! Status: SUCCESS"
    ];
    
    let stepIdx = 0;
    const interval = setInterval(() => {
        if (stepIdx < pipelineSteps.length) {
            awsLogLines.push(pipelineSteps[stepIdx]);
            renderAwsObservability();
            stepIdx++;
        } else {
            clearInterval(interval);
            if (btn) btn.disabled = false;
            showAwsToast("DevOps Pipeline completed successfully!", "success");
            // Auto add to ECR and refresh
            if (awsResources && awsResources.ecr_repos && awsResources.ecr_repos.length > 0) {
                const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
                const firstRepo = awsResources.ecr_repos[0];
                const existing = firstRepo.images.find(img => img.tag === 'latest');
                if (existing) {
                    existing.pushed = nowStr;
                } else {
                    firstRepo.images.unshift({
                        tag: 'latest',
                        digest: 'sha256:abcd1234efgh5678',
                        pushed: nowStr
                    });
                }
            }
        }
    }, 800);
}

// ---------------- SAVE CREDENTIALS FORM ----------------
async function testAndSaveAwsConfig() {
    const key = document.getElementById('aws-input-key').value.trim();
    const secret = document.getElementById('aws-input-secret').value.trim();
    const region = document.getElementById('aws-input-region').value.trim();
    const btn = document.getElementById('aws-btn-save-config');
    
    if (!key || !secret || !region) {
        showAwsToast("AWS Access Key ID, Secret Key, and Region are required.", "error");
        return;
    }
    
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Validating & Saving...`;
    
    try {
        // First save configuration to server configuration files
        const saveRes = await apiCommand('aws_save_config', {
            aws_access_key_id: key,
            aws_secret_access_key: secret,
            aws_default_region: region
        });
        
        if (saveRes.success) {
            // Test connection
            const connRes = await apiCommand('aws_test_connection');
            if (connRes.connected) {
                showAwsToast("Successfully connected to AWS! Credentials saved.", "success");
                awsConfig.connected = true;
                awsConfig.arn = connRes.arn;
                awsConfig.mode = 'real';
                awsConfig.has_credentials = true;
                awsConfig.aws_access_key_id = key.slice(0, 4) + '*'.repeat(12) + key.slice(-4);
                document.getElementById('aws-masked-key').innerText = `Configured Access Key: ${awsConfig.aws_access_key_id}`;
                
                await refreshAwsData();
                switchAwsTab('overview');
            } else {
                showAwsToast(`Credentials saved but connection failed. Using Demo Mode. Error: ${connRes.error}`, "warning");
                awsConfig.connected = false;
                awsConfig.mode = 'demo';
                awsConfig.has_credentials = true;
                awsConfig.aws_access_key_id = key.slice(0, 4) + '*'.repeat(12) + key.slice(-4);
                document.getElementById('aws-masked-key').innerText = `Configured Access Key: ${awsConfig.aws_access_key_id}`;
                
                await refreshAwsData();
                switchAwsTab('overview');
            }
        } else {
            showAwsToast(`Failed to save configuration: ${saveRes.error}`, "error");
        }
    } catch (e) {
        showAwsToast("Save Configuration API invocation failed", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Test & Save Connection`;
    }
}
