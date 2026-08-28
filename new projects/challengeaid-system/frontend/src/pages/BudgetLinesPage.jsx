import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatAmount } from '../components/StatusBadge';

export function BudgetLinesPage() {
  const [centres, setCentres] = useState([]);
  const [lines, setLines] = useState([]);
  const [form, setForm] = useState({ name: '', centreId: '', allocatedAmount: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.listBudgetLines().then(setLines).catch((err) => setError(err.message));
  }
  useEffect(() => {
    api.listCentres().then(setCentres).catch((err) => setError(err.message));
    load();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createBudgetLine({ ...form, allocatedAmount: Number(form.allocatedAmount) });
      setForm({ name: '', centreId: '', allocatedAmount: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header"><h1>Budget Lines</h1></div>
      {error && <div className="error-banner">{error}</div>}

      {lines.map((l) => (
        <div key={l.id} className="request-row">
          <div className="request-row-main">
            <div className="recipient">{l.name}</div>
            <div className="meta">Allocated {formatAmount(l.allocated_amount)} · Spent {formatAmount(l.spent_to_date)}</div>
          </div>
          <div className="amount">{formatAmount(l.remaining)} left</div>
        </div>
      ))}

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3>Add a budget line</h3>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="centreId">Centre</label>
            <select id="centreId" value={form.centreId} onChange={(e) => setForm((f) => ({ ...f, centreId: e.target.value }))} required>
              <option value="" disabled>Select a centre…</option>
              {centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="field">
            <label htmlFor="allocatedAmount">Allocated amount (KES)</label>
            <input id="allocatedAmount" type="number" min="1" value={form.allocatedAmount} onChange={(e) => setForm((f) => ({ ...f, allocatedAmount: e.target.value }))} required />
          </div>
          <button type="submit" className="primary" disabled={busy}>Add budget line</button>
        </form>
      </div>
    </div>
  );
}
