import { useState, useEffect } from 'react';
import { ShieldAlert, Activity, ShieldCheck, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function SecurityEvents() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:3002/api/alerts')
      .then(res => res.json())
      .then(data => {
        setAlerts(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch alerts:', err);
        setLoading(false);
      });
  }, []);

  const getLevelBadge = (level) => {
    if (level >= 10) return <span className="badge level-high">Lvl {level} (High)</span>;
    if (level >= 7) return <span className="badge level-medium">Lvl {level} (Medium)</span>;
    if (level >= 4) return <span className="badge level-low">Lvl {level} (Low)</span>;
    return <span className="badge level-info">Lvl {level} (Info)</span>;
  };

  if (loading) {
    return <div className="loading">Loading security events...</div>;
  }

  const chartData = [
    { name: '08:00', alerts: 12 },
    { name: '09:00', alerts: 19 },
    { name: '10:00', alerts: 15 },
    { name: '11:00', alerts: 42 },
    { name: '12:00', alerts: 28 },
    { name: '13:00', alerts: 10 },
    { name: '14:00', alerts: alerts.length },
  ];

  return (
    <div className="security-events">
      <div className="dashboard-grid">
        <div className="stat-card">
          <div className="stat-header">
            <span>Total Alerts (24h)</span>
            <Activity size={20} color="var(--accent-blue)" />
          </div>
          <div className="stat-value">{alerts.length * 24}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span>High Severity</span>
            <ShieldAlert size={20} color="var(--alert-red)" />
          </div>
          <div className="stat-value">{alerts.filter(a => a.level >= 10).length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span>Active Agents</span>
            <ShieldCheck size={20} color="var(--success-green)" />
          </div>
          <div className="stat-value">3</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Alerts Volume Over Time</div>
        <div style={{ height: '300px', width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
                itemStyle={{ color: 'var(--accent-blue)' }}
              />
              <Bar dataKey="alerts" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Recent Security Events</div>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Level</th>
                <th>Rule ID</th>
                <th>Description</th>
                <th>Agent</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map(alert => (
                <tr key={alert.id}>
                  <td style={{ color: 'var(--text-muted)' }}>{new Date(alert.timestamp).toLocaleString()}</td>
                  <td>{getLevelBadge(alert.level)}</td>
                  <td style={{ fontFamily: 'monospace' }}>{alert.rule}</td>
                  <td>{alert.description}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{alert.agent}</td>
                </tr>
              ))}
              {alerts.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    <AlertCircle size={24} style={{ marginBottom: '8px' }} />
                    <br />
                    No recent security events found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
