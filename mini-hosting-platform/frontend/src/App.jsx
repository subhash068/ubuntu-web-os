import React, { useState, useEffect, useRef } from "react";
import "./index.css";

function App() {
  // Navigation & Authentication states
  const [token, setToken] = useState(null);
  const [authView, setAuthView] = useState("login"); // "login" | "register" | "dashboard"
  const [userEmail, setUserEmail] = useState("");
  
  // Tab control
  const [activeTab, setActiveTab] = useState("dashboard"); 
  // "dashboard" | "projects" | "databases" | "storage" | "functions" | "ai" | "monitoring" | "dns" | "logs"

  // Dashboard form states (Deploy)
  const [domain, setDomain] = useState("");
  const [file, setFile] = useState(null);
  const [githubUrl, setGithubUrl] = useState("");
  const [envVars, setEnvVars] = useState("");
  const [replicas, setReplicas] = useState(1);
  
  // Dashboard & App Data states
  const [deployments, setDeployments] = useState([]);
  const [databases, setDatabases] = useState([]);
  const [buckets, setBuckets] = useState([]);
  const [functions, setFunctions] = useState([]);
  const [monitoringStats, setMonitoringStats] = useState({
    cpu_usage: 0,
    ram_usage: 0,
    bandwidth_gb: 0,
    storage_usage: 0,
    database_usage: 0,
    monthly_requests: 0,
    active_users: 0,
    ssl_certificates: 0,
  });
  
  // Creation Form states
  const [newDbName, setNewDbName] = useState("");
  const [newDbType, setNewDbType] = useState("PostgreSQL 15");
  const [newBucketName, setNewBucketName] = useState("");
  const [newFnName, setNewFnName] = useState("");
  const [newFnTrigger, setNewFnTrigger] = useState("HTTP");

  // AI Chat states
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { sender: "ai", text: "Welcome to Agenthoryx Copilot. How can I help you deploy, scale, or configure your services today?" }
  ]);

  // General App states
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [serverIP, setServerIP] = useState("");
  const [dnsCheckLoading, setDnsCheckLoading] = useState(false);
  const [dnsCheckResult, setDnsCheckResult] = useState(null);
  const [activeLogContainer, setActiveLogContainer] = useState(null);
  
  // Auth Form Inputs
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const wsRef = useRef(null);
  const chatEndRef = useRef(null);

  // Authenticate session on load
  useEffect(() => {
    const savedToken = localStorage.getItem("mhp_token");
    if (savedToken) {
      verifyToken(savedToken);
    } else {
      setAuthView("login");
    }
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Poll server health & load tabs data
  useEffect(() => {
    if (!token) return;

    // Load initial data
    loadDeployments(token);
    loadDatabases(token);
    loadBuckets(token);
    loadFunctions(token);
    loadMonitoringStats(token);
    loadServerIP();

    // Setup polling for monitoring stats
    const statsInterval = setInterval(() => {
      loadMonitoringStats(token);
    }, 5000);

    return () => clearInterval(statsInterval);
  }, [token]);

  // Scroll chat window to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, activeTab]);

  const verifyToken = (chkToken) => {
    fetch("http://localhost:8000/api/auth/me", {
      headers: { "Authorization": `Bearer ${chkToken}` }
    })
      .then(res => {
        if (!res.ok) throw new Error("Session expired");
        return res.json();
      })
      .then(data => {
        setToken(chkToken);
        setUserEmail(data.email);
        setAuthView("dashboard");
      })
      .catch(() => {
        handleLogout();
      });
  };

  const loadDeployments = (authToken) => {
    fetch("http://localhost:8000/api/deployments", {
      headers: { "Authorization": `Bearer ${authToken}` }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setDeployments(data);
      })
      .catch(err => console.error("Failed to load deployments:", err));
  };

  const loadDatabases = (authToken) => {
    fetch("http://localhost:8000/api/databases", {
      headers: { "Authorization": `Bearer ${authToken}` }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setDatabases(data);
      })
      .catch(err => console.error("Failed to load databases:", err));
  };

  const loadBuckets = (authToken) => {
    fetch("http://localhost:8000/api/storage/buckets", {
      headers: { "Authorization": `Bearer ${authToken}` }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setBuckets(data);
      })
      .catch(err => console.error("Failed to load buckets:", err));
  };

  const loadFunctions = (authToken) => {
    fetch("http://localhost:8000/api/functions", {
      headers: { "Authorization": `Bearer ${authToken}` }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setFunctions(data);
      })
      .catch(err => console.error("Failed to load functions:", err));
  };

  const loadMonitoringStats = (authToken) => {
    fetch("http://localhost:8000/api/monitoring/stats", {
      headers: { "Authorization": `Bearer ${authToken}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data && !data.detail) setMonitoringStats(data);
      })
      .catch(err => console.error("Failed to load monitoring stats:", err));
  };

  const loadServerIP = () => {
    fetch("http://localhost:8000/api/system/ip")
      .then(res => res.json())
      .then(data => {
        if (data.ip) setServerIP(data.ip);
      })
      .catch(err => console.error("Failed to load server IP:", err));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:8000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Invalid credentials");
      
      localStorage.setItem("mhp_token", data.access_token);
      setAuthEmail("");
      setAuthPassword("");
      verifyToken(data.access_token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (authPassword !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("http://localhost:8000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Registration failed");

      setError("Registration successful! Please sign in.");
      setConfirmPassword("");
      setAuthPassword("");
      setAuthView("login");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("mhp_token");
    setToken(null);
    setUserEmail("");
    setAuthView("login");
  };

  const handleCheckDNS = async () => {
    if (!domain) return;
    setDnsCheckLoading(true);
    setDnsCheckResult(null);
    try {
      const res = await fetch(`http://localhost:8000/api/dns/check/${domain}`);
      const data = await res.json();
      setDnsCheckResult(data);
    } catch (err) {
      console.error(err);
      setDnsCheckResult({ error: "Failed to verify DNS" });
    } finally {
      setDnsCheckLoading(false);
    }
  };

  const handleDeploy = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let imageName = undefined;

      if (file) {
        setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: `Uploading and building custom package...` }]);
        const formData = new FormData();
        formData.append("file", file);
        
        const uploadRes = await fetch("http://localhost:8000/api/upload", {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
          body: formData,
        });
        
        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          throw new Error(errText || "Zip upload build failed");
        }
        
        const uploadData = await uploadRes.json();
        imageName = uploadData.imageName;
        setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: `Finished build: ${imageName}` }]);
      }

      let envMap = {};
      if (envVars.trim() !== "") {
        envVars.split("\n").forEach(line => {
          const [key, ...val] = line.split("=");
          if (key && val.length > 0) {
            envMap[key.trim()] = val.join("=").trim();
          }
        });
      }

      const res = await fetch("http://localhost:8000/api/deploy", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ 
          domain: domain || undefined, 
          image_name: imageName || undefined, 
          env: envMap, 
          github_url: githubUrl || undefined, 
          replicas: parseInt(replicas, 10) || 1 
        }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Deployment failed");

      loadDeployments(token);
      setDomain("");
      setFile(null);
      setGithubUrl("");
      setEnvVars("");
      setReplicas(1);
      setDnsCheckResult(null);
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: `Deployed ${data.domain} to target ${data.target_addr}` }]);
      setActiveTab("projects");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (targetDomain) => {
    if (!confirm(`Are you sure you want to delete deployment: ${targetDomain}?`)) return;
    try {
      const res = await fetch(`http://localhost:8000/api/deployments/${targetDomain}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Delete failed");
      setDeployments(prev => prev.filter(d => d.domain !== targetDomain));
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: `Deleted ${targetDomain}` }]);
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchLogs = (containerID) => {
    if (!containerID) return;
    const firstCid = containerID.split(",")[0].trim();
    setActiveLogContainer(firstCid);
    setActiveTab("logs");
    
    if (wsRef.current) wsRef.current.close();

    setLogs([{ time: new Date().toLocaleTimeString(), msg: `Connecting to logs stream for container ${firstCid.slice(0, 12)}...` }]);

    const ws = new WebSocket(`ws://localhost:8000/ws/logs/${firstCid}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: event.data }]);
    };
    ws.onerror = () => {
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: "WebSocket error." }]);
    };
    ws.onclose = () => {
      setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: "WebSocket connection closed." }]);
    };
  };

  // Databases Operations
  const handleCreateDatabase = async (e) => {
    e.preventDefault();
    if (!newDbName) return;
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/api/databases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ name: newDbName, type: newDbType })
      });
      if (!res.ok) throw new Error("Failed to create database");
      setNewDbName("");
      loadDatabases(token);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDatabase = async (name) => {
    if (!confirm(`Provisioned database will be deleted: ${name}. Proceed?`)) return;
    try {
      const res = await fetch(`http://localhost:8000/api/databases/${name}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Delete failed");
      loadDatabases(token);
    } catch (err) {
      alert(err.message);
    }
  };

  // Storage Operations
  const handleCreateBucket = async (e) => {
    e.preventDefault();
    if (!newBucketName) return;
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/api/storage/buckets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ name: newBucketName })
      });
      if (!res.ok) throw new Error("Failed to create bucket");
      setNewBucketName("");
      loadBuckets(token);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBucket = async (name) => {
    if (!confirm(`Storage bucket will be deleted: ${name}. Proceed?`)) return;
    try {
      const res = await fetch(`http://localhost:8000/api/storage/buckets/${name}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Delete failed");
      loadBuckets(token);
    } catch (err) {
      alert(err.message);
    }
  };

  // Functions Operations
  const handleCreateFunction = async (e) => {
    e.preventDefault();
    if (!newFnName) return;
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/api/functions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ name: newFnName, trigger: newFnTrigger })
      });
      if (!res.ok) throw new Error("Failed to deploy function");
      setNewFnName("");
      loadFunctions(token);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  // AI Chat Operations
  const handleSendChatMessage = async (e) => {
    e.preventDefault();
    if (!chatPrompt.trim()) return;

    const userMsg = { sender: "user", text: chatPrompt };
    setChatHistory(prev => [...prev, userMsg]);
    setChatPrompt("");

    try {
      const res = await fetch("http://localhost:8000/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ prompt: userMsg.text })
      });
      const data = await res.json();
      setChatHistory(prev => [...prev, { sender: "ai", text: data.reply }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { sender: "ai", text: "Sorry, I lost connection to the server." }]);
    }
  };

  // Render Login view
  if (authView === "login") {
    return (
      <div className="auth-container">
        <div className="blob blob-blue"></div>
        <div className="blob blob-purple"></div>
        <div className="blob blob-cyan"></div>
        
        <div className="auth-panel glass-panel">
          <div className="auth-header">
            <span className="brand-logo-emoji">⚡</span>
            <h1>Agenthoryx Cloud</h1>
            <p>Build, deploy, and scale with intelligence.</p>
          </div>
          <form onSubmit={handleLogin} className="deploy-form">
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                placeholder="developer@agenthoryx.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
              />
            </div>
            {error && <div className="error-message">{error}</div>}
            <button type="submit" disabled={loading} className="btn btn-primary">
              {loading ? "Verifying..." : "Sign In to Agenthoryx"}
            </button>
          </form>
          <div className="auth-footer">
            New to our cloud?{" "}
            <button onClick={() => { setAuthView("register"); setError(null); }} className="auth-link">
              Create Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render Register view
  if (authView === "register") {
    return (
      <div className="auth-container">
        <div className="blob blob-blue"></div>
        <div className="blob blob-purple"></div>
        <div className="blob blob-cyan"></div>

        <div className="auth-panel glass-panel">
          <div className="auth-header">
            <span className="brand-logo-emoji">⚡</span>
            <h1>Create Agenthoryx ID</h1>
            <p>Deploy globally in seconds.</p>
          </div>
          <form onSubmit={handleRegister} className="deploy-form">
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                placeholder="developer@agenthoryx.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                placeholder="Minimum 6 characters"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input
                type="password"
                placeholder="Re-type password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            {error && <div className="error-message">{error}</div>}
            <button type="submit" disabled={loading} className="btn btn-primary">
              {loading ? "Creating..." : "Sign Up"}
            </button>
          </form>
          <div className="auth-footer">
            Already have an ID?{" "}
            <button onClick={() => { setAuthView("login"); setError(null); }} className="auth-link">
              Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render Dashboard view (authorized)
  return (
    <div className="dashboard-layout">
      <div className="blob blob-blue" style={{ opacity: 0.1, width: "600px", height: "600px", top: "-10%", left: "10%" }}></div>
      <div className="blob blob-purple" style={{ opacity: 0.1, width: "600px", height: "600px", bottom: "-10%", right: "10%" }}></div>
      <div className="blob blob-cyan" style={{ opacity: 0.1, width: "400px", height: "400px", top: "40%", left: "-10%" }}></div>

      <aside className="sidebar-menu">
        <div className="sidebar-brand">
          <span className="logo-icon">⚡</span>
          <h2>Agenthoryx</h2>
        </div>
        
        <div className="sidebar-user">
          <div className="user-avatar">{userEmail[0]?.toUpperCase() || "D"}</div>
          <div className="user-details">
            <span className="user-name">Developer</span>
            <span className="user-email">{userEmail}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
            📊 Dashboard
          </button>
          <button className={`nav-item ${activeTab === "projects" ? "active" : ""}`} onClick={() => setActiveTab("projects")}>
            🚀 App Deployments
          </button>
          <button className={`nav-item ${activeTab === "databases" ? "active" : ""}`} onClick={() => setActiveTab("databases")}>
            🗄️ Managed Databases
          </button>
          <button className={`nav-item ${activeTab === "storage" ? "active" : ""}`} onClick={() => setActiveTab("storage")}>
            📦 Object Storage
          </button>
          <button className={`nav-item ${activeTab === "functions" ? "active" : ""}`} onClick={() => setActiveTab("functions")}>
            λ Edge Functions
          </button>
          <button className={`nav-item ${activeTab === "ai" ? "active" : ""}`} onClick={() => setActiveTab("ai")}>
            🤖 AI Console
          </button>
          <button className={`nav-item ${activeTab === "monitoring" ? "active" : ""}`} onClick={() => setActiveTab("monitoring")}>
            📈 Metrics & Health
          </button>
          <button className={`nav-item ${activeTab === "dns" ? "active" : ""}`} onClick={() => setActiveTab("dns")}>
            🌐 Custom Domains
          </button>
          {activeLogContainer && (
            <button className={`nav-item ${activeTab === "logs" ? "active" : ""}`} onClick={() => setActiveTab("logs")}>
              📜 Container Logs
            </button>
          )}
          
          <button className="nav-item signout-btn" onClick={handleLogout}>
            🚪 Sign Out
          </button>
        </nav>
      </aside>

      <main className="main-content">
        {/* TOP META ROW */}
        <header className="main-header">
          <div className="header-title">
            <h1>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Control Room</h1>
            <p>Agenthoryx Cloud Infrastructure</p>
          </div>
          <div className="server-status">
            <span className="status-dot online"></span>
            <span className="status-text">Server: {serverIP}</span>
          </div>
        </header>

        {/* TAB 1: GENERAL DASHBOARD OVERVIEW */}
        {activeTab === "dashboard" && (
          <div className="dashboard-grid">
            {/* Quick Metrics */}
            <div className="metric-card glass-panel highlight-blue">
              <h3>CPU Usage</h3>
              <div className="metric-value">{monitoringStats.cpu_usage}%</div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${monitoringStats.cpu_usage}%`, background: "var(--accent)" }}></div></div>
            </div>
            <div className="metric-card glass-panel highlight-purple">
              <h3>RAM Usage</h3>
              <div className="metric-value">{monitoringStats.ram_usage}%</div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${monitoringStats.ram_usage}%`, background: "var(--purple)" }}></div></div>
            </div>
            <div className="metric-card glass-panel highlight-cyan">
              <h3>Active Containers</h3>
              <div className="metric-value">{deployments.reduce((sum, dep) => sum + (dep.container_id ? dep.container_id.split(",").length : 0), 0)}</div>
              <div className="metric-sub">Across {deployments.length} apps</div>
            </div>
            <div className="metric-card glass-panel">
              <h3>Edge Requests</h3>
              <div className="metric-value">{monitoringStats.monthly_requests?.toLocaleString() || "0"}</div>
              <div className="metric-sub">This Month</div>
            </div>

            {/* Quick Actions / Getting Started */}
            <div className="dashboard-row span-full">
              <div className="glass-panel quick-start-panel">
                <h2>Ready to deploy a new microservice?</h2>
                <p>Upload a zipped package or reference a public Git repository. We'll automatically build the container and route traffic.</p>
                <button className="btn btn-primary" onClick={() => setActiveTab("projects")} style={{ marginTop: "1rem" }}>
                  Launch Deploy Wizard →
                </button>
              </div>
            </div>

            {/* Active Resources Summaries */}
            <div className="dashboard-row">
              <div className="glass-panel">
                <div className="panel-header">
                  <h2>Databases</h2>
                  <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab("databases")}>Manage</button>
                </div>
                <div className="resource-list">
                  {databases.length === 0 ? (
                    <p className="no-data">No databases provisioned.</p>
                  ) : (
                    databases.map((db, idx) => (
                      <div key={idx} className="resource-item">
                        <div className="resource-icon">🗄️</div>
                        <div className="resource-info">
                          <h4>{db.name}</h4>
                          <span>{db.type} • {db.status}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="dashboard-row">
              <div className="glass-panel">
                <div className="panel-header">
                  <h2>Storage Buckets</h2>
                  <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab("storage")}>Manage</button>
                </div>
                <div className="resource-list">
                  {buckets.length === 0 ? (
                    <p className="no-data">No storage buckets created.</p>
                  ) : (
                    buckets.map((b, idx) => (
                      <div key={idx} className="resource-item">
                        <div className="resource-icon">📦</div>
                        <div className="resource-info">
                          <h4>{b.name}</h4>
                          <span>{b.region} • {b.size_mb} MB ({b.files_count} files)</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PROJECTS & APP DEPLOYMENT */}
        {activeTab === "projects" && (
          <div className="center-content">
            <section className="deploy-section glass-panel">
              <h2 className="section-title">New Deployment Wizard</h2>
              <form onSubmit={handleDeploy} className="deploy-form">
                <div className="form-group">
                  <label>Domain Configuration</label>
                  <div className="input-group">
                    <input 
                      type="text" 
                      placeholder="Domain name (e.g. cognix.com, my-app.local)" 
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                    />
                    <button 
                      type="button" 
                      onClick={handleCheckDNS} 
                      className="check-dns-btn"
                      disabled={dnsCheckLoading || !domain}
                    >
                      {dnsCheckLoading ? "Verifying..." : "Verify DNS"}
                    </button>
                  </div>
                  {dnsCheckResult && (
                    <div className={`dns-status-message ${dnsCheckResult.pointsToMe ? "success" : "warn"}`} style={{ marginTop: "0.5rem" }}>
                      {dnsCheckResult.pointsToMe ? (
                        <span>✓ DNS points correctly to {dnsCheckResult.serverIP}</span>
                      ) : (
                        <span>
                          ✗ Domain resolved to {dnsCheckResult.resolvedIPs.join(", ") || "none"}. Must point to {dnsCheckResult.serverIP}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>GitHub Repository URL</label>
                    <input 
                      type="text" 
                      placeholder="https://github.com/user/repo" 
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      disabled={!!file}
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Upload ZIP Package</label>
                    <input 
                      type="file" 
                      accept=".zip"
                      onChange={(e) => setFile(e.target.files[0])}
                      disabled={!!githubUrl}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Configured Replicas</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="10" 
                      value={replicas}
                      onChange={(e) => setReplicas(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Environment Variables (KEY=VALUE, one per line)</label>
                  <textarea 
                    rows="3" 
                    placeholder="PORT=80&#10;DATABASE_URL=postgresql://..." 
                    value={envVars}
                    onChange={(e) => setEnvVars(e.target.value)}
                    className="env-textarea"
                  />
                </div>

                {error && <div className="error-message">{error}</div>}

                <button type="submit" disabled={loading} className="btn btn-primary btn-block">
                  {loading ? "Deploying Site..." : "Deploy Website"}
                </button>
              </form>
            </section>

            <section className="glass-panel">
              <h2 className="section-title">Active Hostings</h2>
              <div className="deployment-list">
                {deployments.length === 0 ? (
                  <p className="no-data">No active deployments found.</p>
                ) : (
                  deployments.map(dep => (
                    <div key={dep.id} className="deployment-card">
                      <div className="dep-info">
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                          <h3>{dep.domain}</h3>
                          <span className="badge">Active</span>
                        </div>
                        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                          Target Container Address: {dep.target_addr}
                        </p>
                        <a href={`http://${dep.domain}`} target="_blank" rel="noreferrer" className="proxy-link" style={{ marginTop: "0.5rem", display: "inline-block" }}>
                          Visit Site ↗
                        </a>
                      </div>

                      <div className="dep-meta">
                        <span>Image: {dep.image_name ? dep.image_name.slice(0, 30) : ""}{dep.image_name && dep.image_name.length > 30 ? "..." : ""}</span>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button className="action-btn" onClick={() => fetchLogs(dep.container_id)}>
                            Logs
                          </button>
                          <button className="action-btn danger" onClick={() => handleDelete(dep.domain)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: DATABASES */}
        {activeTab === "databases" && (
          <div className="center-content">
            <section className="glass-panel">
              <h2 className="section-title">Provision New Database</h2>
              <form onSubmit={handleCreateDatabase} className="deploy-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Database Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. users-db-prod"
                      value={newDbName}
                      onChange={(e) => setNewDbName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Engine Engine</label>
                    <select 
                      value={newDbType}
                      onChange={(e) => setNewDbType(e.target.value)}
                      className="form-select"
                    >
                      <option value="PostgreSQL 15">PostgreSQL 15</option>
                      <option value="Redis 7">Redis 7</option>
                      <option value="MongoDB 6.0">MongoDB 6.0</option>
                    </select>
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" style={{ marginTop: "1rem" }}>
                  Provision Database
                </button>
              </form>
            </section>

            <section className="glass-panel">
              <h2 className="section-title">Active Database Instances</h2>
              <div className="deployment-list">
                {databases.length === 0 ? (
                  <p className="no-data">No database instances found.</p>
                ) : (
                  databases.map((db, idx) => (
                    <div key={idx} className="deployment-card">
                      <div className="dep-info">
                        <h3>{db.name}</h3>
                        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                          Engine: {db.type} • Status: <span style={{ color: "var(--success)" }}>{db.status}</span>
                        </p>
                        <code className="conn-string">
                          {db.type.includes("PostgreSQL") 
                            ? `postgresql://postgres:secret@localhost:5432/${db.name}` 
                            : db.type.includes("Redis") 
                            ? `redis://:secret@localhost:6379/0` 
                            : `mongodb://localhost:27017/${db.name}`}
                        </code>
                      </div>
                      <div className="dep-meta">
                        <span>{db.size_mb} MB Used</span>
                        <button className="action-btn danger" onClick={() => handleDeleteDatabase(db.name)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 4: STORAGE */}
        {activeTab === "storage" && (
          <div className="center-content">
            <section className="glass-panel">
              <h2 className="section-title">Create Storage Bucket</h2>
              <form onSubmit={handleCreateBucket} className="deploy-form">
                <div className="form-group">
                  <label>Bucket Name (Global ID)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. agenthoryx-static-assets"
                    value={newBucketName}
                    onChange={(e) => setNewBucketName(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ marginTop: "1rem" }}>
                  Create Bucket
                </button>
              </form>
            </section>

            <section className="glass-panel">
              <h2 className="section-title">Storage Buckets</h2>
              <div className="deployment-list">
                {buckets.length === 0 ? (
                  <p className="no-data">No object storage buckets found.</p>
                ) : (
                  buckets.map((b, idx) => (
                    <div key={idx} className="deployment-card">
                      <div className="dep-info">
                        <h3>{b.name}</h3>
                        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                          Region: {b.region} • Files: {b.files_count}
                        </p>
                      </div>
                      <div className="dep-meta">
                        <span>{b.size_mb} MB Size</span>
                        <button className="action-btn danger" onClick={() => handleDeleteBucket(b.name)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 5: FUNCTIONS */}
        {activeTab === "functions" && (
          <div className="center-content">
            <section className="glass-panel">
              <h2 className="section-title">Deploy Serverless Function</h2>
              <form onSubmit={handleCreateFunction} className="deploy-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Function Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. parse-payment-json"
                      value={newFnName}
                      onChange={(e) => setNewFnName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Trigger Type</label>
                    <select 
                      value={newFnTrigger}
                      onChange={(e) => setNewFnTrigger(e.target.value)}
                      className="form-select"
                    >
                      <option value="HTTP">HTTP Endpoint</option>
                      <option value="Cron">Cron Scheduler</option>
                      <option value="Database Change">Database Change (CDC)</option>
                    </select>
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" style={{ marginTop: "1rem" }}>
                  Deploy Function
                </button>
              </form>
            </section>

            <section className="glass-panel">
              <h2 className="section-title">Deployed Functions</h2>
              <div className="deployment-list">
                {functions.length === 0 ? (
                  <p className="no-data">No serverless functions active.</p>
                ) : (
                  functions.map((fn, idx) => (
                    <div key={idx} className="deployment-card">
                      <div className="dep-info">
                        <h3>{fn.name}</h3>
                        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                          Trigger: <span className="badge" style={{ color: "var(--accent)", background: "rgba(59, 130, 246, 0.1)" }}>{fn.trigger}</span>
                        </p>
                      </div>
                      <div className="dep-meta">
                        <span>Invocations: {fn.invocations_count}</span>
                        <span style={{ color: "var(--success)", fontSize: "0.85rem" }}>● Active</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 6: AI CONSOLE */}
        {activeTab === "ai" && (
          <section className="glass-panel ai-panel">
            <div className="ai-header">
              <h2>Agenthoryx AI Copilot</h2>
              <p>Natural language cloud manager. Ask to deploy, provision, or check metrics.</p>
            </div>
            
            <div className="ai-chat-history">
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`chat-message ${msg.sender === "ai" ? "msg-ai" : "msg-user"}`}>
                  <div className="avatar-chat">{msg.sender === "ai" ? "🤖" : "👤"}</div>
                  <div className="text-chat">{msg.text}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleSendChatMessage} className="ai-chat-input-form">
              <input 
                type="text" 
                placeholder="Ask Agenthoryx (e.g., 'Deploy database' or 'Create a static assets storage bucket')"
                value={chatPrompt}
                onChange={(e) => setChatPrompt(e.target.value)}
              />
              <button type="submit" className="btn btn-primary">Send</button>
            </form>
          </section>
        )}

        {/* TAB 7: MONITORING & HEALTH */}
        {activeTab === "monitoring" && (
          <div className="dashboard-grid">
            <div className="glass-panel main-chart-card span-full">
              <h2>Resource Utilization Live Stream</h2>
              <div style={{ display: "flex", gap: "2rem", marginTop: "1.5rem" }}>
                <div style={{ flex: 1 }}>
                  <h4>CPU Load ({monitoringStats.cpu_usage}%)</h4>
                  <div className="progress-bar lg"><div className="progress-fill" style={{ width: `${monitoringStats.cpu_usage}%`, background: "var(--accent)" }}></div></div>
                </div>
                <div style={{ flex: 1 }}>
                  <h4>Memory Usage ({monitoringStats.ram_usage}%)</h4>
                  <div className="progress-bar lg"><div className="progress-fill" style={{ width: `${monitoringStats.ram_usage}%`, background: "var(--purple)" }}></div></div>
                </div>
              </div>
            </div>

            <div className="glass-panel">
              <h3>Bandwidth Consumed</h3>
              <div className="metric-large" style={{ color: "var(--cyan)" }}>{monitoringStats.bandwidth_gb} GB</div>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Outbound CDN Data</p>
            </div>

            <div className="glass-panel">
              <h3>SSL Certificates</h3>
              <div className="metric-large" style={{ color: "var(--success)" }}>{monitoringStats.ssl_certificates} Active</div>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Fully managed Let's Encrypt routes</p>
            </div>
          </div>
        )}

        {/* TAB 8: DNS SETTINGS */}
        {activeTab === "dns" && (
          <div className="main-layout">
            <section className="glass-panel dns-instructions" style={{ gridColumn: "span 3" }}>
              <h2>DNS Mapping Instructions</h2>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                To route traffic to your deployments, map your domain's DNS settings at your registrar:
              </p>

              <div className="dns-table-container">
                <table className="dns-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Host</th>
                      <th>Points To</th>
                      <th>TTL</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className="record-type">A</span></td>
                      <td><code>@</code></td>
                      <td><code>{serverIP || "127.0.0.1"}</code></td>
                      <td>1 Hour (or Automatic)</td>
                    </tr>
                    <tr>
                      <td><span className="record-type">CNAME</span></td>
                      <td><code>www</code></td>
                      <td><code>@</code></td>
                      <td>1 Hour (or Automatic)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="dns-tip">
                💡 <strong>Important:</strong> After saving DNS settings, it can take some time to propagate globally. You can verify your setup using the "Verify DNS" tool on the Dashboard.
              </div>
            </section>
          </div>
        )}

        {/* TAB 9: LOGS CONSOLE */}
        {activeTab === "logs" && (
          <section className="glass-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2>Live Log Console</h2>
              {activeLogContainer && (
                <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                  Container: <code>{activeLogContainer.slice(0, 12)}</code>
                </span>
              )}
            </div>
            
            <div className="terminal">
              {logs.map((log, idx) => (
                <div key={idx} className="log-line">
                  <span className="time">[{log.time}]</span> {log.msg}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
