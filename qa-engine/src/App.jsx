import React, { useState, useEffect, useRef } from 'react';
import { faker } from '@faker-js/faker';
import './index.css';

// SVG Icons
const Icons = {
  Dashboard: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1"></rect><rect x="14" y="3" width="7" height="5" rx="1"></rect><rect x="14" y="12" width="7" height="9" rx="1"></rect><rect x="3" y="16" width="7" height="5" rx="1"></rect></svg>,
  Plan: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>,
  Manual: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>,
  Auto: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>,
  Api: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>,
  Bug: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="6" width="8" height="14" rx="4"></rect><path d="M12 2v4"></path><path d="M6 10h2"></path><path d="M16 10h2"></path><path d="M6 14h2"></path><path d="M16 14h2"></path><path d="M6 18h2"></path><path d="M16 18h2"></path></svg>,
  CI: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 16 16 12 12 8"></polyline><line x1="8" y1="12" x2="16" y2="12"></line></svg>,
  Play: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>,
  Data: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>,
  Export: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 3v5h5M16 13H8M16 17H8M10 9H8"/></svg>
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Global QA State
  const [environment, setEnvironment] = useState('Staging');

  // Auto Engine State
  const [targetUrl, setTargetUrl] = useState('http://localhost:5000');
  const [testFileName, setTestFileName] = useState('');
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const terminalRef = useRef(null);

  // Manual Test State
  const [checklists, setChecklists] = useState([
    { id: 1, text: 'Verify user can log in with valid credentials', done: true },
    { id: 2, text: 'Verify validation error on empty password', done: false },
    { id: 3, text: 'Test responsive layout on mobile viewport (320px)', done: false },
    { id: 4, text: 'Check accessibility contrast ratios', done: false }
  ]);

  // API State
  const [apiUrl, setApiUrl] = useState('https://jsonplaceholder.typicode.com/todos/1');
  const [apiMethod, setApiMethod] = useState('GET');
  const [apiResponse, setApiResponse] = useState('');
  const [apiLoading, setApiLoading] = useState(false);
  const [apiHistory, setApiHistory] = useState([
    { method: 'GET', url: 'https://api.example.com/v1/health', status: 200, time: 42 },
    { method: 'POST', url: 'https://api.example.com/v1/login', status: 401, time: 120 }
  ]);

  // Bug Tracker State
  const [bugs, setBugs] = useState([
    { id: 'QA-102', title: 'Calculator division by zero crashes UI', priority: 'High', status: 'To Do' },
    { id: 'QA-105', title: 'Missing favicon on settings page', priority: 'Low', status: 'To Do' },
    { id: 'QA-098', title: 'Login API returns 500 on timeout', priority: 'Med', status: 'In Progress' },
    { id: 'QA-087', title: 'Terminal disconnects after 5 mins', priority: 'High', status: 'Ready' }
  ]);
  const [newBugTitle, setNewBugTitle] = useState('');
  const [newBugPriority, setNewBugPriority] = useState('Med');

  // Enterprise Upgrades State
  const [generatedData, setGeneratedData] = useState([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [scheduleTime, setScheduleTime] = useState('02:00');
  const [isScheduled, setIsScheduled] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logs]);

  const toggleChecklist = (id) => {
    setChecklists(prev => prev.map(c => c.id === id ? { ...c, done: !c.done } : c));
  };

  const runAutomation = async () => {
    setIsRunning(true);
    setLogs(['[Playwright Engine] Initializing test sequence...']);

    try {
      const response = await fetch('http://localhost:3001/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl, testFile: testFileName || undefined, webhookUrl })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let failed = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const events = chunk.split('\n\n').filter(Boolean);
        for (let event of events) {
          if (event.startsWith('data: ')) {
            try {
              const data = JSON.parse(event.replace('data: ', ''));
              if (data.type === 'stdout' || data.type === 'stderr') setLogs(prev => [...prev, data.data]);
              else if (data.type === 'exit') {
                if (data.code !== 0) failed = true;
                setLogs(prev => [...prev, `\n[System] Test process exited with code ${data.code}`]);
                setIsRunning(false);
                if (failed) setShowArtifacts(true);
              }
            } catch (e) {}
          }
        }
      }
    } catch (error) {
      setLogs(prev => [...prev, `Error: Failed to connect to local engine backend on port 3001.`]);
      setIsRunning(false);
    }
  };

  const scheduleAutomation = async () => {
    try {
      await fetch('http://localhost:3001/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: scheduleTime, suite: testFileName || 'All' })
      });
      setIsScheduled(true);
      alert(`Scheduled tests to run at ${scheduleTime} daily.`);
    } catch(e) {
      alert("Scheduling failed");
    }
  };

  const generateData = (type) => {
    const newData = [];
    for(let i=0; i<10; i++) {
      if(type==='user') newData.push({ id: faker.string.uuid(), name: faker.person.fullName(), email: faker.internet.email(), pass: faker.internet.password() });
      if(type==='card') newData.push({ type: faker.finance.creditCardIssuer(), number: faker.finance.creditCardNumber(), cvv: faker.finance.creditCardCVV() });
      if(type==='address') newData.push({ street: faker.location.streetAddress(), city: faker.location.city(), zip: faker.location.zipCode() });
    }
    setGeneratedData(newData);
  };

  const testApi = async () => {
    setApiLoading(true);
    setApiResponse('Sending request...');
    try {
      const start = Date.now();
      const res = await fetch(apiUrl, { method: apiMethod });
      const data = await res.json();
      const time = Date.now() - start;
      setApiResponse(`Status: ${res.status} ${res.statusText} (${time}ms)\n\n${JSON.stringify(data, null, 2)}`);
      
      // Add to history
      setApiHistory([{ method: apiMethod, url: apiUrl, status: res.status, time }, ...apiHistory].slice(0, 10));
    } catch (err) {
      setApiResponse(`Error: ${err.message}`);
    }
    setApiLoading(false);
  };

  const NavItem = ({ id, icon: Icon, label }) => (
    <div className={`nav-link ${activeTab === id ? 'active' : ''}`} onClick={() => setActiveTab(id)}>
      <Icon /> {label}
    </div>
  );

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="brand">
          <div className="brand-icon"><Icons.Api /></div>
          QA Engine
        </div>

        <div className="input-group" style={{marginBottom: '20px'}}>
          <label className="input-label" style={{fontSize: '0.75rem', letterSpacing: '0.05em'}}>GLOBAL ENVIRONMENT</label>
          <select 
            className="input-field" 
            style={{background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', fontWeight: 'bold'}}
            value={environment}
            onChange={e => setEnvironment(e.target.value)}
          >
            <option value="Localhost">Localhost (Dev)</option>
            <option value="Staging">Staging (QA)</option>
            <option value="Pre-Prod">Pre-Prod (UAT)</option>
            <option value="Production">Production (Live)</option>
          </select>
        </div>
        
        <div style={{color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', marginBottom: '12px', marginTop: '10px'}}>OVERVIEW</div>
        <NavItem id="dashboard" icon={Icons.Dashboard} label="Dashboard" />
        
        <div style={{color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', marginBottom: '12px', marginTop: '24px'}}>TESTING PILLARS</div>
        <NavItem id="planning" icon={Icons.Plan} label="Test Planning" />
        <NavItem id="manual" icon={Icons.Manual} label="Manual Testing" />
        <NavItem id="automation" icon={Icons.Auto} label="Automated Engine" />
        <NavItem id="api" icon={Icons.Api} label="API & DB Lab" />
        <NavItem id="data" icon={Icons.Data} label="Data Factory" />
        
        <div style={{color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', marginBottom: '12px', marginTop: '24px'}}>MANAGEMENT</div>
        <NavItem id="bugs" icon={Icons.Bug} label="Bug Tracker" />
        <NavItem id="cicd" icon={Icons.CI} label="CI/CD Pipelines" />
      </div>

      {/* Main Content */}
      <div className="main-content">
        
        {/* 1. Dashboard */}
        {activeTab === 'dashboard' && (
          <div>
            <div className="page-header print-header">
              <div>
                <h1 className="page-title">Quality Assurance Hub</h1>
                <div className="page-subtitle">Centralized view of platform stability and test metrics</div>
              </div>
              <button className="btn btn-secondary no-print" onClick={() => window.print()}>
                <Icons.Export /> Export PDF Report
              </button>
            </div>
            
            <div className="grid-3" style={{marginBottom: '30px'}}>
              <div className="glass-panel">
                <div className="stat-label">Automation Pass Rate</div>
                <div className="stat-value" style={{background: 'linear-gradient(135deg, #34d399, #10b981)', WebkitBackgroundClip: 'text'}}>96.4%</div>
                <div style={{color: 'var(--accent-secondary)', fontSize: '0.85rem'}}>▲ 2.1% from last week</div>
              </div>
              <div className="glass-panel">
                <div className="stat-label">Open Critical Bugs</div>
                <div className="stat-value" style={{background: 'linear-gradient(135deg, #f87171, #ef4444)', WebkitBackgroundClip: 'text'}}>3</div>
                <div style={{color: 'var(--text-muted)', fontSize: '0.85rem'}}>In Jira project ENG</div>
              </div>
              <div className="glass-panel">
                <div className="stat-label">Target Environment</div>
                <div className="stat-value" style={{background: 'linear-gradient(135deg, #60a5fa, #3b82f6)', WebkitBackgroundClip: 'text'}}>{environment}</div>
                <div style={{color: 'var(--text-muted)', fontSize: '0.85rem'}}>Currently selected workspace</div>
              </div>
            </div>

            <div className="glass-panel">
              <h3 style={{marginBottom: '20px'}}>Recent Test Executions</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Suite Name</th>
                      <th>Target Env</th>
                      <th>Duration</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{fontWeight: 500}}>E2E Payment Flow</td>
                      <td>Production</td>
                      <td>2m 14s</td>
                      <td><span className="status-badge passed">Passed</span></td>
                    </tr>
                    <tr>
                      <td style={{fontWeight: 500}}>User Authentication</td>
                      <td>Staging</td>
                      <td>45s</td>
                      <td><span className="status-badge failed">Failed</span></td>
                    </tr>
                    <tr>
                      <td style={{fontWeight: 500}}>Nightly Regression</td>
                      <td>QA-Env-1</td>
                      <td>-</td>
                      <td><span className="status-badge running">Running</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 2. Test Planning */}
        {activeTab === 'planning' && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">Test Cases & Design</h1>
                <div className="page-subtitle">Design requirements and expected behaviors before execution</div>
              </div>
              <button className="btn"><Icons.Plan /> New Test Case</button>
            </div>
            
            <div className="grid-1-2">
              <div className="glass-panel">
                <h3 style={{marginBottom: '16px'}}>Test Suites</h3>
                <div className="nav-link active">Authentication (12)</div>
                <div className="nav-link">Checkout Flow (8)</div>
                <div className="nav-link">User Profile (5)</div>
                <div className="nav-link">Settings & Config (14)</div>
              </div>
              <div className="glass-panel">
                <h3 style={{marginBottom: '20px'}}>TC-Auth-04: Login with Invalid Password</h3>
                <div className="input-group">
                  <label className="input-label">Description / Objective</label>
                  <p style={{color: 'var(--text-muted)', fontSize: '0.95rem'}}>Verify that the system denies access and shows appropriate error message when correct username but wrong password is provided.</p>
                </div>
                <div className="input-group">
                  <label className="input-label">Test Steps</label>
                  <ol style={{color: 'var(--text-muted)', paddingLeft: '20px', lineHeight: '1.8'}}>
                    <li>Navigate to <code>/login</code></li>
                    <li>Enter valid username 'admin'</li>
                    <li>Enter invalid password 'wrong123'</li>
                    <li>Click 'Login' button</li>
                  </ol>
                </div>
                <div className="input-group">
                  <label className="input-label" style={{color: 'var(--accent-secondary)'}}>Expected Result & Execution</label>
                  <div style={{background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16,185,129,0.3)', padding: '12px', borderRadius: '8px', color: '#6ee7b7', marginBottom: '16px'}}>
                    User remains on login page and red toast notification appears saying "Invalid credentials".
                  </div>
                  
                  <div style={{display: 'flex', gap: '12px'}}>
                    <button className="btn btn-success" style={{flex: 1}}>Mark Passed</button>
                    <button className="btn" style={{flex: 1, background: 'var(--accent-danger)'}}>Mark Failed</button>
                    <button className="btn btn-secondary" style={{flex: 1}}>Block / Skip</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. Manual Testing */}
        {activeTab === 'manual' && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">Manual Execution</h1>
                <div className="page-subtitle">Exploratory testing checklists and session notes</div>
              </div>
              <button className="btn btn-secondary">Record Session</button>
            </div>

            <div className="grid-1-2">
              <div className="glass-panel">
                <h3 style={{marginBottom: '20px'}}>Execution Checklist</h3>
                <div style={{display: 'flex', flexDirection: 'column'}}>
                  {checklists.map(item => (
                    <div key={item.id} className={`checklist-item ${item.done ? 'done' : ''}`} onClick={() => toggleChecklist(item.id)}>
                      <input type="checkbox" checked={item.done} readOnly />
                      <span className="cl-text">{item.text}</span>
                    </div>
                  ))}
                </div>
                <div className="input-group" style={{marginTop: '20px'}}>
                  <input type="text" className="input-field" placeholder="+ Add checklist item..." onKeyDown={(e) => {
                    if(e.key === 'Enter' && e.target.value) {
                      setChecklists([...checklists, { id: Date.now(), text: e.target.value, done: false }]);
                      e.target.value = '';
                    }
                  }}/>
                </div>
              </div>

              <div className="glass-panel">
                <h3 style={{marginBottom: '20px'}}>Exploratory Notes</h3>
                <textarea className="textarea-field" style={{height: '300px'}} placeholder="Log observations, odd behaviors, or UI glitches here during your manual session..."></textarea>
                <div style={{marginTop: '16px', display: 'flex', justifyContent: 'flex-end'}}>
                  <button className="btn">Save Notes</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. Automated Engine */}
        {activeTab === 'automation' && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">Playwright Engine</h1>
                <div className="page-subtitle">Execute automated UI and E2E scripts against target environments</div>
              </div>
            </div>

            <div className="grid-2" style={{gridTemplateColumns: '1fr 2fr'}}>
              <div className="glass-panel">
                <h3 style={{marginBottom: '20px'}}>Run Configuration</h3>
                
                <div className="input-group">
                  <label className="input-label">Target URL</label>
                  <input type="text" className="input-field" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">Test File Filter</label>
                  <input type="text" className="input-field" value={testFileName} onChange={(e) => setTestFileName(e.target.value)} placeholder="e.g. desktop.spec.js" />
                </div>
                <div className="input-group">
                  <label className="input-label">Browser Matrix</label>
                  <div style={{display: 'flex', gap: '12px'}}>
                    <label style={{display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)'}}><input type="checkbox" defaultChecked /> Chromium</label>
                    <label style={{display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)'}}><input type="checkbox" /> Firefox</label>
                    <label style={{display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)'}}><input type="checkbox" /> WebKit</label>
                  </div>
                </div>

                <div className="input-group" style={{marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px'}}>
                  <label className="input-label">Nightly Cron Schedule (HH:MM)</label>
                  <div style={{display: 'flex', gap: '12px'}}>
                    <input type="time" className="input-field" value={scheduleTime} onChange={e=>setScheduleTime(e.target.value)} />
                    <button className="btn btn-secondary" onClick={scheduleAutomation} disabled={isScheduled}>
                      {isScheduled ? 'Scheduled' : 'Set Cron'}
                    </button>
                  </div>
                </div>

                <button className="btn btn-success" style={{width: '100%', marginTop: '20px', justifyContent: 'center'}} onClick={runAutomation} disabled={isRunning}>
                  {isRunning ? 'Running...' : <><Icons.Play /> Execute Tests</>}
                </button>
                
                {showArtifacts && (
                  <button className="btn btn-secondary" style={{width: '100%', marginTop: '10px', justifyContent: 'center', color: '#f87171', borderColor: '#f87171'}} onClick={() => window.open('http://localhost:3001/report/index.html', '_blank')}>
                    View Failure Trace & Video
                  </button>
                )}
              </div>

              <div className="glass-panel">
                <h3 style={{marginBottom: '20px'}}>Live Console</h3>
                <div className="terminal-output" ref={terminalRef}>
                  {logs.length === 0 ? <span style={{color: 'rgba(255,255,255,0.3)'}}>&gt; Ready. Awaiting execution trigger...</span> : logs.map((log, i) => <div key={i}>{log}</div>)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 5. API & DB Lab */}
        {activeTab === 'api' && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">API & Database Lab</h1>
                <div className="page-subtitle">Send requests to backend services and query database states</div>
              </div>
            </div>

            <div className="grid-2" style={{gridTemplateColumns: '2fr 1fr'}}>
              <div className="glass-panel" style={{marginBottom: '24px'}}>
                <h3 style={{marginBottom: '16px'}}>REST Client</h3>
                <div style={{display: 'flex', gap: '12px', marginBottom: '20px'}}>
                  <select className="input-field" style={{width: '120px', fontWeight: 'bold', color: 'var(--accent-primary)'}} value={apiMethod} onChange={e=>setApiMethod(e.target.value)}>
                    <option>GET</option>
                    <option>POST</option>
                    <option>PUT</option>
                    <option>DELETE</option>
                  </select>
                  <input type="text" className="input-field" value={apiUrl} onChange={e=>setApiUrl(e.target.value)} />
                  <button className="btn" onClick={testApi} disabled={apiLoading}>{apiLoading ? '...' : 'Send'}</button>
                </div>
                <div className="api-response">
                  {apiResponse || '// Response payload will appear here'}
                </div>
              </div>
              
              <div className="glass-panel" style={{marginBottom: '24px'}}>
                <h3 style={{marginBottom: '16px'}}>Request History</h3>
                <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                  {apiHistory.map((req, i) => (
                    <div key={i} style={{padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer'}} onClick={() => { setApiUrl(req.url); setApiMethod(req.method); }}>
                      <div>
                        <span className={`api-method ${req.method.toLowerCase()}`} style={{fontSize: '0.7rem', padding: '2px 6px', marginRight: '8px'}}>{req.method}</span>
                        <span style={{fontSize: '0.85rem', color: 'var(--text-muted)'}}>{req.url.substring(0, 25)}...</span>
                      </div>
                      <span className={`status-badge ${req.status < 400 ? 'passed' : 'failed'}`} style={{fontSize: '0.7rem'}}>{req.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 6. Bug Tracker */}
        {activeTab === 'bugs' && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">Defect Tracking</h1>
                <div className="page-subtitle">Manage, assign, and track lifecycle of identified issues</div>
              </div>
            </div>
            <div className="glass-panel" style={{marginBottom: '24px'}}>
              <div style={{display: 'flex', gap: '12px'}}>
                <input type="text" className="input-field" placeholder="Describe the defect..." value={newBugTitle} onChange={e=>setNewBugTitle(e.target.value)} style={{flex: 2}} />
                <select className="input-field" value={newBugPriority} onChange={e=>setNewBugPriority(e.target.value)} style={{flex: 1}}>
                  <option value="High">High Priority</option>
                  <option value="Med">Medium Priority</option>
                  <option value="Low">Low Priority</option>
                </select>
                <button className="btn btn-secondary" onClick={() => {
                  if(newBugTitle) {
                    setBugs([...bugs, { id: `QA-${Math.floor(Math.random()*100)+100}`, title: newBugTitle, priority: newBugPriority, status: 'To Do' }]);
                    setNewBugTitle('');
                  }
                }}>+ Report Bug</button>
              </div>
            </div>

            <div className="kanban-board">
              {/* Column 1 */}
              <div className="kanban-column">
                <div className="kanban-title">To Do <span className="kanban-badge">{bugs.filter(b=>b.status==='To Do').length}</span></div>
                {bugs.filter(b=>b.status==='To Do').map(bug => (
                  <div key={bug.id} className="kanban-card">
                    <div className="kanban-card-title">{bug.title}</div>
                    <div className="kanban-card-meta"><span className={`tag ${bug.priority.toLowerCase()}`}>{bug.priority}</span> <span>{bug.id}</span></div>
                  </div>
                ))}
              </div>

              {/* Column 2 */}
              <div className="kanban-column">
                <div className="kanban-title">In Progress (Dev) <span className="kanban-badge">{bugs.filter(b=>b.status==='In Progress').length}</span></div>
                {bugs.filter(b=>b.status==='In Progress').map(bug => (
                  <div key={bug.id} className="kanban-card">
                    <div className="kanban-card-title">{bug.title}</div>
                    <div className="kanban-card-meta"><span className={`tag ${bug.priority.toLowerCase()}`}>{bug.priority}</span> <span>{bug.id}</span></div>
                  </div>
                ))}
              </div>

              {/* Column 3 */}
              <div className="kanban-column">
                <div className="kanban-title">Ready for QA Verify <span className="kanban-badge">{bugs.filter(b=>b.status==='Ready').length}</span></div>
                {bugs.filter(b=>b.status==='Ready').map(bug => (
                  <div key={bug.id} className="kanban-card">
                    <div className="kanban-card-title">{bug.title}</div>
                    <div className="kanban-card-meta"><span className={`tag ${bug.priority.toLowerCase()}`}>{bug.priority}</span> <span>{bug.id}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Data Factory */}
        {activeTab === 'data' && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">Data Factory</h1>
                <div className="page-subtitle">Instantly generate realistic mock data for testing suites</div>
              </div>
            </div>

            <div className="grid-3" style={{marginBottom: '24px'}}>
              <div className="glass-panel" style={{textAlign: 'center', cursor: 'pointer'}} onClick={() => generateData('user')}>
                <h3 style={{color: 'var(--accent-primary)'}}>👥 User Profiles</h3>
                <p style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px'}}>Generate 10 users (Name, Email, UUID)</p>
              </div>
              <div className="glass-panel" style={{textAlign: 'center', cursor: 'pointer'}} onClick={() => generateData('card')}>
                <h3 style={{color: 'var(--accent-secondary)'}}>💳 Credit Cards</h3>
                <p style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px'}}>Generate 10 CC numbers and CVVs</p>
              </div>
              <div className="glass-panel" style={{textAlign: 'center', cursor: 'pointer'}} onClick={() => generateData('address')}>
                <h3 style={{color: 'var(--accent-purple)'}}>📍 Addresses</h3>
                <p style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px'}}>Generate 10 realistic US addresses</p>
              </div>
            </div>

            {generatedData.length > 0 && (
              <div className="glass-panel">
                <h3 style={{marginBottom: '16px'}}>Generated Dataset</h3>
                <div className="api-response" style={{maxHeight: '400px', overflowY: 'auto'}}>
                  {JSON.stringify(generatedData, null, 2)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 7. CI/CD */}
        {activeTab === 'cicd' && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">CI/CD Pipelines & Webhooks</h1>
                <div className="page-subtitle">Continuous integration monitors and deployment triggers</div>
              </div>
            </div>

            <div className="glass-panel" style={{marginBottom: '24px', background: 'rgba(59, 130, 246, 0.05)', borderColor: 'rgba(59, 130, 246, 0.2)'}}>
              <h3 style={{marginBottom: '16px'}}>Webhook Alerts</h3>
              <p style={{fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px'}}>Send Slack or Discord messages automatically when an automated test fails.</p>
              <div style={{display: 'flex', gap: '12px'}}>
                <input type="text" className="input-field" placeholder="https://hooks.slack.com/services/..." value={webhookUrl} onChange={e=>setWebhookUrl(e.target.value)} style={{flex: 2}} />
                <button className="btn" onClick={() => alert('Webhook URL Saved for next execution!')}>Save Configuration</button>
              </div>
            </div>

            <div className="glass-panel">
              <h3 style={{marginBottom: '20px'}}>Pipeline: ubuntu-web-os / main</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Run ID</th>
                      <th>Commit</th>
                      <th>Stages (Build → Test → Deploy)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{fontWeight: 500}}>#1042</td>
                      <td>feat: add QA Engine iframe</td>
                      <td style={{color: 'var(--accent-secondary)', letterSpacing: '2px'}}>● ── ● ── ○</td>
                      <td><span className="status-badge running">In Progress</span></td>
                    </tr>
                    <tr>
                      <td style={{fontWeight: 500}}>#1041</td>
                      <td>fix: terminal resizing bug</td>
                      <td style={{color: 'var(--accent-secondary)', letterSpacing: '2px'}}>● ── ● ── ●</td>
                      <td><span className="status-badge passed">Success</span></td>
                    </tr>
                    <tr>
                      <td style={{fontWeight: 500}}>#1040</td>
                      <td>chore: update dependencies</td>
                      <td style={{color: 'var(--accent-danger)', letterSpacing: '2px'}}>● ── ● ── x</td>
                      <td><span className="status-badge failed">Failed</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
