import { useState, useEffect } from 'react';
import { Bug, Package, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';

export default function Vulnerabilities() {
  const [vulns, setVulns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:3002/api/vulnerabilities')
      .then(res => res.json())
      .then(data => {
        setVulns(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch vulnerabilities:', err);
        setLoading(false);
      });
  }, []);

  const getSeverityBadge = (severity) => {
    if (severity === 'Critical') return <span className="badge level-high">Critical</span>;
    if (severity === 'High') return <span className="badge level-medium">High</span>;
    if (severity === 'Medium') return <span className="badge level-low">Medium</span>;
    return <span className="badge level-info">Low</span>;
  };

  const getStatusBadge = (status) => {
    if (status === 'Resolved') {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--success-green)', fontSize: '0.85rem' }}>
          <CheckCircle2 size={14} /> Resolved
        </span>
      );
    }
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--alert-red)', fontSize: '0.85rem' }}>
        <AlertTriangle size={14} /> Unresolved
      </span>
    );
  };

  if (loading) {
    return <div className="loading">Loading vulnerability data...</div>;
  }

  const criticalCount = vulns.filter(v => v.severity === 'Critical').length;
  const highCount = vulns.filter(v => v.severity === 'High').length;
  const unresolvedCount = vulns.filter(v => v.status === 'Unresolved').length;

  const pieData = [
    { name: 'Critical', value: criticalCount, color: 'var(--alert-red)' },
    { name: 'High', value: highCount, color: 'var(--warning-yellow)' },
    { name: 'Medium', value: vulns.filter(v => v.severity === 'Medium').length, color: 'var(--accent-blue)' },
    { name: 'Low', value: vulns.filter(v => v.severity === 'Low').length, color: 'var(--success-green)' },
  ];

  return (
    <div className="vulnerabilities">
      <div className="dashboard-grid">
        <div className="stat-card">
          <div className="stat-header">
            <span>Critical CVEs</span>
            <Bug size={20} color="var(--alert-red)" />
          </div>
          <div className="stat-value">{criticalCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span>High CVEs</span>
            <Bug size={20} color="var(--warning-yellow)" />
          </div>
          <div className="stat-value">{highCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <span>Total Unresolved</span>
            <AlertTriangle size={20} color="var(--accent-indigo)" />
          </div>
          <div className="stat-value">{unresolvedCount}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
        <div className="panel">
          <div className="panel-title">Severity Distribution</div>
          <div style={{ height: '250px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData.filter(d => d.value > 0)}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-color)', color: 'var(--text-main)' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Detected Vulnerabilities (CVEs)</div>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>CVE ID</th>
                  <th>Severity</th>
                  <th>Affected Package</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {vulns.map((vuln, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: '600', color: 'var(--text-main)' }}>{vuln.cve}</td>
                    <td>{getSeverityBadge(vuln.severity)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-blue)' }}>
                        <Package size={14} />
                        {vuln.package}
                      </div>
                    </td>
                    <td>{getStatusBadge(vuln.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
