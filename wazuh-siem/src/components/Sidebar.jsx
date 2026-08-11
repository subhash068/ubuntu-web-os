import { Shield, ShieldAlert, FileSearch, Bug, Settings, Server, Activity } from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab }) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard Overview', icon: Activity },
    { id: 'events', label: 'Security Events', icon: ShieldAlert },
    { id: 'fim', label: 'File Integrity Monitoring', icon: FileSearch },
    { id: 'vuln', label: 'Vulnerabilities', icon: Bug },
  ];

  const systemItems = [
    { id: 'agents', label: 'Agents', icon: Server },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <Shield color="var(--accent-blue)" size={28} />
        <span>Wazuh SIEM</span>
      </div>

      <div className="sidebar-nav">
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '10px 15px', marginTop: '10px' }}>
          Modules
        </div>
        {menuItems.map((item) => (
          <div
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
          >
            <item.icon size={18} />
            {item.label}
          </div>
        ))}

        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '10px 15px', marginTop: '20px' }}>
          Management
        </div>
        {systemItems.map((item) => (
          <div
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
          >
            <item.icon size={18} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
