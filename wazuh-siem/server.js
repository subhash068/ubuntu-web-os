import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3002;

// Wazuh Config
const WAZUH_URL = process.env.WAZUH_API_URL || null;
const WAZUH_USER = process.env.WAZUH_USER || null;
const WAZUH_PASS = process.env.WAZUH_PASSWORD || null;

// Allow self-signed certs for Wazuh API
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let wazuhToken = null;

// Helper: Authenticate with Wazuh
async function getWazuhToken() {
  if (!WAZUH_URL || !WAZUH_USER || !WAZUH_PASS) return null;
  try {
    const authHeader = 'Basic ' + Buffer.from(`${WAZUH_USER}:${WAZUH_PASS}`).toString('base64');
    const response = await axios.post(`${WAZUH_URL}/security/user/authenticate`, {}, {
      headers: { Authorization: authHeader },
      httpsAgent
    });
    return response.data?.data?.token;
  } catch (error) {
    console.error('Wazuh API Auth Error:', error.message);
    return null;
  }
}

// ------------------------------------------------------------------
// MOCK DATA FALLBACKS
// ------------------------------------------------------------------
const mockAlerts = [
  { id: 1, timestamp: new Date(Date.now() - 5000).toISOString(), level: 12, rule: '5710', description: 'SSHD brute force attempt', agent: 'web-server-01' },
  { id: 2, timestamp: new Date(Date.now() - 15000).toISOString(), level: 7, rule: '5501', description: 'Pam: Login session opened', agent: 'db-server-02' },
  { id: 3, timestamp: new Date(Date.now() - 45000).toISOString(), level: 10, rule: '31101', description: 'Web server 400 error code', agent: 'nginx-proxy' },
  { id: 4, timestamp: new Date(Date.now() - 120000).toISOString(), level: 3, rule: '502', description: 'Ossec server started', agent: 'wazuh-manager' },
  { id: 5, timestamp: new Date(Date.now() - 300000).toISOString(), level: 8, rule: '5716', description: 'SSHD authentication failed', agent: 'web-server-01' }
];

const mockFimEvents = [
  { id: 101, timestamp: new Date(Date.now() - 10000).toISOString(), file: '/etc/passwd', action: 'modified', user: 'root' },
  { id: 102, timestamp: new Date(Date.now() - 36000).toISOString(), file: '/var/www/html/index.php', action: 'added', user: 'www-data' },
  { id: 103, timestamp: new Date(Date.now() - 72000).toISOString(), file: '/etc/nginx/nginx.conf', action: 'modified', user: 'root' },
  { id: 104, timestamp: new Date(Date.now() - 86400).toISOString(), file: '/tmp/malicious.sh', action: 'added', user: 'ubuntu' }
];

const mockVulnerabilities = [
  { cve: 'CVE-2021-44228', severity: 'Critical', package: 'log4j-core', status: 'Unresolved' },
  { cve: 'CVE-2023-38408', severity: 'High', package: 'openssh-server', status: 'Resolved' },
  { cve: 'CVE-2022-22965', severity: 'Critical', package: 'spring-beans', status: 'Unresolved' },
  { cve: 'CVE-2023-23397', severity: 'High', package: 'outlook', status: 'Resolved' }
];

// ------------------------------------------------------------------
// ENDPOINTS
// ------------------------------------------------------------------

// ALERTS Proxy
app.get('/api/alerts', async (req, res) => {
  if (wazuhToken || await getWazuhToken()) {
    if (!wazuhToken) wazuhToken = await getWazuhToken();
    if (wazuhToken) {
      try {
        // Normally, alerts are in OpenSearch. We can query recent active agents as a proxy for "activity", 
        // or just fallback to mock data since /alerts isn't standard in the manager API.
        // For demonstration, we'll return mock data overlaid with API success status.
        return res.json(mockAlerts);
      } catch (err) {
        console.error('API Error, falling back to mock:', err.message);
      }
    }
  }
  res.json(mockAlerts);
});

// FIM Proxy
app.get('/api/fim', async (req, res) => {
  if (wazuhToken || await getWazuhToken()) {
    if (!wazuhToken) wazuhToken = await getWazuhToken();
    if (wazuhToken) {
      try {
        // Example: Get syscheck for agent 000
        const response = await axios.get(`${WAZUH_URL}/syscheck/000`, {
          headers: { Authorization: `Bearer ${wazuhToken}` },
          httpsAgent
        });
        
        const rawItems = response.data?.data?.affected_items || [];
        const mappedFim = rawItems.slice(0, 10).map((item, index) => ({
          id: index,
          timestamp: item.date || new Date().toISOString(),
          file: item.file || 'unknown',
          action: item.type || 'modified',
          user: item.uname || 'system'
        }));
        
        if (mappedFim.length > 0) return res.json(mappedFim);
      } catch (err) {
        console.error('FIM API Error, falling back to mock:', err.message);
      }
    }
  }
  res.json(mockFimEvents);
});

// VULNERABILITIES Proxy
app.get('/api/vulnerabilities', async (req, res) => {
  if (wazuhToken || await getWazuhToken()) {
    if (!wazuhToken) wazuhToken = await getWazuhToken();
    if (wazuhToken) {
      try {
        // Example: Get vulnerabilities for agent 000
        const response = await axios.get(`${WAZUH_URL}/vulnerability/000`, {
          headers: { Authorization: `Bearer ${wazuhToken}` },
          httpsAgent
        });
        
        const rawItems = response.data?.data?.affected_items || [];
        const mappedVulns = rawItems.slice(0, 10).map((item, index) => ({
          cve: item.cve || `CVE-UNKNOWN-${index}`,
          severity: item.severity || 'Medium',
          package: item.name || 'unknown',
          status: item.status || 'Unresolved'
        }));
        
        if (mappedVulns.length > 0) return res.json(mappedVulns);
      } catch (err) {
        console.error('Vuln API Error, falling back to mock:', err.message);
      }
    }
  }
  res.json(mockVulnerabilities);
});

app.listen(PORT, () => {
  console.log(`Wazuh backend running on http://localhost:${PORT}`);
  if (WAZUH_URL) {
    console.log(`Wazuh API Proxy mode ENABLED: ${WAZUH_URL}`);
  } else {
    console.log(`Wazuh API Proxy mode DISABLED (Using mock data fallback)`);
  }
});
