import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { PAYMENT_TYPE_LABEL } from '../components/StatusBadge';

export function NewRequestPage() {
  const navigate = useNavigate();
  const [centres, setCentres] = useState([]);
  const [budgetLines, setBudgetLines] = useState([]);
  const [form, setForm] = useState({
    centreId: '',
    budgetLineId: '',
    paymentType: 'coach_fee',
    recipientName: '',
    recipientAccount: '',
    recipientPhone: '',
    amount: '',
    justification: ''
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listCentres().then(setCentres).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!form.centreId) {
      setBudgetLines([]);
      return;
    }
    api.listBudgetLines(form.centreId).then(setBudgetLines).catch((err) => setError(err.message));
  }, [form.centreId]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!form.recipientAccount && !form.recipientPhone) {
      setError('Provide a bank account or a mobile money number for the recipient.');
      return;
    }

    setBusy(true);
    try {
      const created = await api.createRequest({
        centreId: form.centreId,
        budgetLineId: form.budgetLineId,
        paymentType: form.paymentType,
        recipientName: form.recipientName,
        recipientAccount: form.recipientAccount || undefined,
        recipientPhone: form.recipientPhone || undefined,
        amount: Number(form.amount),
        justification: form.justification
      });
      navigate(`/requests/${created.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedBudgetLine = budgetLines.find((b) => b.id === form.budgetLineId);

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-header">
        <h1>New Payment Request</h1>
      </div>

      <form className="card" onSubmit={handleSubmit}>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="centre">Centre</label>
          <select id="centre" value={form.centreId} onChange={(e) => update('centreId', e.target.value)} required>
            <option value="" disabled>Select a centre…</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.location})</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="budgetLine">Budget line</label>
          <select
            id="budgetLine"
            value={form.budgetLineId}
            onChange={(e) => update('budgetLineId', e.target.value)}
            required
            disabled={!form.centreId}
          >
            <option value="" disabled>Select a budget line…</option>
            {budgetLines.map((b) => (
              <option key={b.id} value={b.id}>{b.name} — {b.remaining} remaining</option>
            ))}
          </select>
          {selectedBudgetLine && (
            <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '0.35rem' }}>
              Allocated {selectedBudgetLine.allocated_amount}, spent {selectedBudgetLine.spent_to_date}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="paymentType">Payment type</label>
          <select id="paymentType" value={form.paymentType} onChange={(e) => update('paymentType', e.target.value)}>
            {Object.entries(PAYMENT_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="recipientName">Recipient name</label>
          <input
            id="recipientName"
            value={form.recipientName}
            onChange={(e) => update('recipientName', e.target.value)}
            required
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="field">
            <label htmlFor="recipientAccount">Bank account (if applicable)</label>
            <input
              id="recipientAccount"
              value={form.recipientAccount}
              onChange={(e) => update('recipientAccount', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="recipientPhone">Mobile number (if applicable)</label>
            <input
              id="recipientPhone"
              value={form.recipientPhone}
              onChange={(e) => update('recipientPhone', e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="amount">Amount (KES)</label>
          <input
            id="amount"
            type="number"
            min="1"
            step="1"
            value={form.amount}
            onChange={(e) => update('amount', e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="justification">Justification</label>
          <textarea
            id="justification"
            rows={3}
            value={form.justification}
            onChange={(e) => update('justification', e.target.value)}
            required
          />
        </div>

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
        <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '0.75rem' }}>
          This goes to Finance first, then the Director, then all four Trustees — the sequence is fixed
          regardless of amount.
        </p>
      </form>
    </div>
  );
}
