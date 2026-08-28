const { query } = require('../config/db');

async function summary(req, res, next) {
  try {
    const { centreId } = req.query;
    const centreFilter = centreId ? 'WHERE centre_id = $1' : '';
    const params = centreId ? [centreId] : [];

    const { rows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('disbursed', 'reconciled')) AS total_disbursed,
         COUNT(*) FILTER (WHERE status = 'reconciled') AS total_reconciled,
         COUNT(*) FILTER (WHERE status = 'disbursed') AS total_outstanding
       FROM payment_requests ${centreFilter}`,
      params
    );

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// Aging report: outstanding (disbursed, not yet reconciled) requests
// bucketed by days since disbursement, per Section 8.
async function aging(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT
         pr.id, pr.recipient_name, pr.amount, pr.payment_type, pr.centre_id,
         pe.execution_date,
         EXTRACT(DAY FROM now() - pe.execution_date)::int AS days_outstanding
       FROM payment_requests pr
       JOIN payment_executions pe ON pe.request_id = pr.id
       WHERE pr.status = 'disbursed'
       ORDER BY pe.execution_date ASC`
    );

    const buckets = { over_30: [], over_14: [], over_7: [], under_7: [] };
    for (const row of rows) {
      if (row.days_outstanding >= 30) buckets.over_30.push(row);
      else if (row.days_outstanding >= 14) buckets.over_14.push(row);
      else if (row.days_outstanding >= 7) buckets.over_7.push(row);
      else buckets.under_7.push(row);
    }

    res.json(buckets);
  } catch (err) {
    next(err);
  }
}

module.exports = { summary, aging };
