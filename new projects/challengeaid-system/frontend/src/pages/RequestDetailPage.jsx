import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge, formatAmount, formatDate, PAYMENT_TYPE_LABEL } from '../components/StatusBadge';
import { ApprovalStampRow } from '../components/ApprovalStampRow';

const APPROVER_ROLES = ['finance', 'director', 'trustee'];

const DOC_TYPE_LABEL = {
  signed_payment_form: 'Signed payment form',
  coach_acknowledgement: 'Coach acknowledgement',
  vendor_receipt: 'Vendor receipt / invoice',
  delivery_note: 'Delivery note',
  supervisor_confirmation: 'Supervisor confirmation',
  service_confirmation: 'Service confirmation',
  other_evidence: 'Other evidence'
};

export function RequestDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState('');

  const load = useCallback(() => {
    setError(null);
    return api.getRequest(id).then(setRequest).catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleDecision(decision) {
    if (decision === 'rejected' && !comments.trim()) {
      setError('A rejection needs a reason in the comments field.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.decide(id, { decision, comments: comments.trim() || undefined });
      setComments('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleExecute(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    setBusy(true);
    setError(null);
    try {
      await api.execute(id, {
        method: form.get('method'),
        transactionReference: form.get('transactionReference')
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    setBusy(true);
    setError(null);
    try {
      await api.uploadDocument(id, {
        documentType: form.get('documentType'),
        fileUrl: form.get('fileUrl')
      });
      e.target.reset();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!request && !error) return <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>;
  if (error && !request) return <div className="error-banner">{error}</div>;

  const canDecide = APPROVER_ROLES.includes(user.role) && isMyTurn(request, user);
  const canExecute = (user.role === 'finance' || user.role === 'admin') && request.status === 'trustee_approved';
  const canUpload = ['staff', 'finance', 'admin'].includes(user.role) && ['disbursed', 'reconciled'].includes(request.status);

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <div>
          <h1>{request.recipient_name}</h1>
          <p className="eyebrow" style={{ marginTop: '0.25rem' }}>
            {PAYMENT_TYPE_LABEL[request.payment_type]} · Submitted {formatDate(request.submitted_at)}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="amount">{formatAmount(request.amount)}</span>
        </div>
        <hr className="hairline" />
        <p><strong>Justification:</strong> {request.justification}</p>
        <p style={{ marginBottom: 0 }}>
          <strong>Recipient:</strong> {request.recipient_name}
          {request.recipient_account && <> · Account <span className="mono">{request.recipient_account}</span></>}
          {request.recipient_phone && <> · Phone <span className="mono">{request.recipient_phone}</span></>}
        </p>
        {request.rejection_reason && (
          <p style={{ color: 'var(--stamp-brick)', marginTop: '0.75rem' }}>
            <strong>Rejection reason:</strong> {request.rejection_reason}
          </p>
        )}
      </div>

      <h2 style={{ marginTop: '2rem' }}>Approval Chain</h2>
      <ApprovalStampRow approvalStatus={request.approvalStatus} />

      {canDecide && (
        <div className="card">
          <h3>Your decision</h3>
          <div className="field" style={{ marginTop: '0.75rem' }}>
            <label htmlFor="comments">Comments (required for rejection)</label>
            <textarea id="comments" rows={2} value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="stamp-teal" disabled={busy} onClick={() => handleDecision('approved')}>Approve</button>
            <button className="stamp-amber" disabled={busy} onClick={() => handleDecision('more_info_requested')}>Request Info</button>
            <button className="stamp-brick" disabled={busy} onClick={() => handleDecision('rejected')}>Reject</button>
          </div>
        </div>
      )}

      {canExecute && (
        <div className="card">
          <h3>Execute payment</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
            All four trustees have signed off. Release the funds via Cooperative Bank, then record the
            confirmation here.
          </p>
          <form onSubmit={handleExecute}>
            <div className="field">
              <label htmlFor="method">Method</label>
              <select id="method" name="method">
                <option value="cooperative_bank_transfer">Cooperative Bank transfer</option>
                <option value="mco_op_cash">M-Co-op Cash</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="transactionReference">Transaction reference</label>
              <input id="transactionReference" name="transactionReference" required />
            </div>
            <button type="submit" className="primary" disabled={busy}>Record payment executed</button>
          </form>
        </div>
      )}

      {canUpload && (
        <div className="card">
          <h3>Reconciliation documents</h3>
          {request.reconciliation && (
            <>
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                Required for this payment type: {request.reconciliation.required.map((d) => DOC_TYPE_LABEL[d]).join(', ')}
              </p>
              <ul style={{ paddingLeft: '1.2rem', fontSize: '0.88rem' }}>
                {request.reconciliation.required.map((d) => (
                  <li key={d} style={{ color: request.reconciliation.present.includes(d) ? 'var(--stamp-teal)' : 'var(--ink-soft)' }}>
                    {request.reconciliation.present.includes(d) ? '✓ ' : '○ '}{DOC_TYPE_LABEL[d]}
                  </li>
                ))}
              </ul>
            </>
          )}
          <form onSubmit={handleUpload}>
            <div className="field">
              <label htmlFor="documentType">Document type</label>
              <select id="documentType" name="documentType">
                {Object.entries(DOC_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fileUrl">File reference (URL or path)</label>
              <input id="fileUrl" name="fileUrl" placeholder="e.g. https://…/receipt.pdf" required />
            </div>
            <button type="submit" disabled={busy}>Attach document</button>
          </form>
        </div>
      )}
    </div>
  );
}

// A given approver role can act only when it's their stage's turn —
// mirrors the backend's assertStageIsUnlocked so the UI doesn't offer
// a button that the API would reject anyway.
function isMyTurn(request, user) {
  const status = request.status;
  if (user.role === 'finance') return ['submitted', 'more_info_requested'].includes(status);
  if (user.role === 'director') return status === 'finance_approved';
  if (user.role === 'trustee') {
    if (status !== 'director_approved') return false;
    const already = (request.approvalStatus?.trusteeApprovals || []).some((t) => t.approver_id === user.id);
    return !already;
  }
  return false;
}
