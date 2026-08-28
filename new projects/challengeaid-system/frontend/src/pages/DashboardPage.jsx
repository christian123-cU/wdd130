import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatAmount, formatDate } from '../components/StatusBadge';

export function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [aging, setAging] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.dashboardSummary(), api.dashboardAging()])
      .then(([s, a]) => { setSummary(s); setAging(a); })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {summary && (
        <div className="summary-grid">
          <div className="summary-tile">
            <span className="eyebrow">Total Disbursed</span>
            <span className="count">{summary.total_disbursed}</span>
          </div>
          <div className="summary-tile">
            <span className="eyebrow">Total Reconciled</span>
            <span className="count" style={{ color: 'var(--stamp-teal)' }}>{summary.total_reconciled}</span>
          </div>
          <div className="summary-tile">
            <span className="eyebrow">Outstanding</span>
            <span className="count" style={{ color: 'var(--stamp-amber)' }}>{summary.total_outstanding}</span>
          </div>
        </div>
      )}

      <h2>Aging — Outstanding Disbursements</h2>
      {aging && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
          <AgingBucket title="30+ days" tone="bad" items={aging.over_30} />
          <AgingBucket title="14–29 days" tone="progress" items={aging.over_14} />
          <AgingBucket title="7–13 days" tone="progress" items={aging.over_7} />
          <AgingBucket title="Under 7 days" tone="good" items={aging.under_7} />
        </div>
      )}
    </div>
  );
}

function AgingBucket({ title, tone, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>
        {title} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>({items.length})</span>
      </h3>
      {items.map((item) => (
        <div key={item.id} className="request-row">
          <div className="request-row-main">
            <div className="recipient">{item.recipient_name}</div>
            <div className="meta">Disbursed {formatDate(item.execution_date)}</div>
          </div>
          <div className="amount">{formatAmount(item.amount)}</div>
          <span className={`status-badge ${tone}`}>{item.days_outstanding}d outstanding</span>
        </div>
      ))}
    </div>
  );
}
