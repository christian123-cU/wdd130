import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, formatAmount, formatDate, PAYMENT_TYPE_LABEL } from '../components/StatusBadge';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'finance_approved', label: 'Finance Approved' },
  { value: 'director_approved', label: 'Director Approved' },
  { value: 'trustee_approved', label: 'Fully Approved' },
  { value: 'disbursed', label: 'Disbursed' },
  { value: 'reconciled', label: 'Reconciled' },
  { value: 'rejected', label: 'Rejected' }
];

export function RequestsListPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .listRequests(status ? { status } : {})
      .then(setRequests)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{user.role === 'staff' ? 'Your Requests' : 'Payment Requests'}</h1>
          <p className="eyebrow" style={{ marginTop: '0.25rem' }}>
            {user.role === 'staff' ? 'Everything you have submitted' : 'Full disbursement pipeline'}
          </p>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 220 }}>
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>}

      {!loading && requests.length === 0 && (
        <div className="empty-state card">
          <p>No requests here yet.</p>
          {user.role === 'staff' && <Link to="/new-request">Submit your first request →</Link>}
        </div>
      )}

      {requests.map((r) => (
        <Link key={r.id} to={`/requests/${r.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="request-row">
            <div className="request-row-main">
              <div className="recipient">{r.recipient_name}</div>
              <div className="meta">
                {PAYMENT_TYPE_LABEL[r.payment_type] || r.payment_type} · Submitted {formatDate(r.submitted_at)}
              </div>
            </div>
            <div className="amount">{formatAmount(r.amount)}</div>
            <StatusBadge status={r.status} />
          </div>
        </Link>
      ))}
    </div>
  );
}
