// Renders one stamp per approval stage: Finance, Director, and each of
// the four Trustees individually. A stamp is "pending" (dashed outline,
// empty) until a decision lands, then fills in as approved / rejected /
// waiting-info — mirroring the physical signed-form workflow this
// system replaces.

function Stamp({ label, who, state }) {
  const mark = { approved: '✓', rejected: '✕', 'waiting-info': '?', pending: '' }[state];
  return (
    <div className="stamp">
      <div className={`stamp-circle ${state}`}>{mark}</div>
      <div className="stamp-label">
        {label}
        {who && <span className="who">{who}</span>}
      </div>
    </div>
  );
}

function decisionToState(decision) {
  if (decision === 'approved') return 'approved';
  if (decision === 'rejected') return 'rejected';
  if (decision === 'more_info_requested') return 'waiting-info';
  return 'pending';
}

export function ApprovalStampRow({ approvalStatus }) {
  if (!approvalStatus) return null;

  const finance = approvalStatus.financeDecision;
  const director = approvalStatus.directorDecision;
  const trustees = approvalStatus.trusteeApprovals || [];

  // Show up to 4 trustee slots — filled ones show who signed, the
  // rest stay pending regardless of who eventually signs them.
  const trusteeSlots = Array.from({ length: approvalStatus.trusteesRequired || 4 }, (_, i) => trustees[i] || null);

  return (
    <div className="stamp-row">
      <Stamp
        label="Finance"
        who={finance?.approver_name}
        state={decisionToState(finance?.decision)}
      />
      <Stamp
        label="Director"
        who={director?.approver_name}
        state={decisionToState(director?.decision)}
      />
      {trusteeSlots.map((t, i) => (
        <Stamp
          key={i}
          label={`Trustee ${i + 1}`}
          who={t?.approver_name}
          state={t ? 'approved' : 'pending'}
        />
      ))}
    </div>
  );
}
