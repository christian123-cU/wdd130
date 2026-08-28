const STATUS_META = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'progress' },
  finance_approved: { label: 'Finance Approved', tone: 'progress' },
  director_approved: { label: 'Director Approved', tone: 'progress' },
  trustee_approved: { label: 'Fully Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  more_info_requested: { label: 'More Info Needed', tone: 'progress' },
  disbursed: { label: 'Disbursed', tone: 'progress' },
  reconciled: { label: 'Reconciled', tone: 'good' }
};

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, tone: 'neutral' };
  return <span className={`status-badge ${meta.tone}`}>{meta.label}</span>;
}

export function formatAmount(amount) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(
    Number(amount)
  );
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const PAYMENT_TYPE_LABEL = {
  coach_fee: 'Coach fee',
  foodstuffs: 'Foodstuffs',
  supplies: 'Supplies / materials',
  cleaning: 'Cleaning services',
  other: 'Other / miscellaneous'
};
