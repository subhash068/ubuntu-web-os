import { useState, useEffect } from 'react';
import { FileSearch, User, Hash } from 'lucide-react';

export default function FileIntegrity() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:3002/api/fim')
      .then(res => res.json())
      .then(data => {
        setEvents(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch FIM events:', err);
        setLoading(false);
      });
  }, []);

  const getActionBadge = (action) => {
    if (action === 'added') return <span className="badge level-info">Added</span>;
    if (action === 'modified') return <span className="badge level-medium">Modified</span>;
    if (action === 'deleted') return <span className="badge level-high">Deleted</span>;
    return <span className="badge level-low">{action}</span>;
  };

  if (loading) {
    return <div className="loading">Loading file integrity events...</div>;
  }

  return (
    <div className="fim-events">
      <div className="dashboard-grid">
        <div className="stat-card">
          <div className="stat-header">
            <span>Files Modified (24h)</span>
            <FileSearch size={20} color="var(--warning-yellow)" />
          </div>
          <div className="stat-value">{events.filter(e => e.action === 'modified').length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span>Files Added</span>
            <FileSearch size={20} color="var(--success-green)" />
          </div>
          <div className="stat-value">{events.filter(e => e.action === 'added').length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span>Files Deleted</span>
            <FileSearch size={20} color="var(--alert-red)" />
          </div>
          <div className="stat-value">{events.filter(e => e.action === 'deleted').length}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">File Integrity Monitoring Alerts</div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>File Path</th>
                <th>User</th>
                <th>Hash Verified</th>
              </tr>
            </thead>
            <tbody>
              {events.map(event => (
                <tr key={event.id}>
                  <td style={{ color: 'var(--text-muted)' }}>{new Date(event.timestamp).toLocaleString()}</td>
                  <td>{getActionBadge(event.action)}</td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--accent-blue)' }}>{event.file}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <User size={14} color="var(--text-muted)" />
                      {event.user}
                    </div>
                  </td>
                  <td>
                    <Hash size={16} color="var(--success-green)" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
