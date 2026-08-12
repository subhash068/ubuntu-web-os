import { useState } from 'react';
import Sidebar from './components/Sidebar';
import SecurityEvents from './components/SecurityEvents';
import FileIntegrity from './components/FileIntegrity';
import Vulnerabilities from './components/Vulnerabilities';
import { UserCircle, Bell } from 'lucide-react';

function App() {
  const [activeTab, setActiveTab] = useState('events');

  const renderContent = () => {
    switch (activeTab) {
      case 'events':
        return <SecurityEvents />;
      case 'fim':
        return <FileIntegrity />;
      case 'vuln':
        return <Vulnerabilities />;
      case 'dashboard':
        return <div className="panel"><p style={{color: 'var(--text-muted)'}}>Welcome to Wazuh SIEM. Select a module from the sidebar to view details.</p></div>;
      default:
        return <div className="panel"><div className="panel-title">Module Not Found</div><p style={{color: 'var(--text-muted)'}}>The selected module is not available.</p></div>;
    }
  };

  const getTitle = () => {
    switch (activeTab) {
      case 'dashboard': return 'Dashboard Overview';
      case 'events': return 'Security Events';
      case 'fim': return 'File Integrity Monitoring';
      case 'vuln': return 'Vulnerabilities';
      default: return 'Wazuh SIEM';
    }
  };

  return (
    <div className="app-container">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <div className="main-content">
        <div className="topbar">
          <div className="page-title">{getTitle()}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ position: 'relative', cursor: 'pointer' }}>
              <Bell size={20} color="var(--text-muted)" />
              <div style={{ position: 'absolute', top: '-4px', right: '-4px', width: '8px', height: '8px', backgroundColor: 'var(--alert-red)', borderRadius: '50%' }}></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-main)' }}>
              <UserCircle size={24} color="var(--text-muted)" />
              <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>wazuh-admin</span>
            </div>
          </div>
        </div>
        
        <div className="content-area">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

export default App;
