const { AppError } = require('../middleware/errorHandler');

/**
 * Throws if committing `amount` against a budget line would exceed
 * its allocation, counting both already-spent funds and everything
 * currently in the approval pipeline (submitted but not yet
 * disbursed), so Finance can see the real remaining headroom rather
 * than being surprised later.
 */
async function assertBudgetAvailable(client, { budgetLineId, amount, excludeRequestId = null }) {
  const { rows: blRows } = await client.query('SELECT * FROM budget_lines WHERE id = $1 FOR UPDATE', [budgetLineId]);
  const budgetLine = blRows[0];
  if (!budgetLine) throw new AppError('Budget line not found', 404);

  const { rows: pipelineRows } = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS pipeline_total FROM payment_requests
     WHERE budget_line_id = $1
       AND status NOT IN ('rejected', 'reconciled')
       AND ($2::uuid IS NULL OR id != $2)`,
    [budgetLineId, excludeRequestId]
  );

  const pipelineTotal = Number(pipelineRows[0].pipeline_total);
  const spent = Number(budgetLine.spent_to_date);
  const allocated = Number(budgetLine.allocated_amount);
  const committed = spent + pipelineTotal;
  const remaining = allocated - committed;

  if (Number(amount) > remaining) {
    throw new AppError(
      `Request of ${amount} exceeds remaining budget on '${budgetLine.name}' ` +
        `(allocated: ${allocated}, already spent: ${spent}, already committed in pipeline: ${pipelineTotal}, ` +
        `remaining: ${remaining.toFixed(2)})`,
      422
    );
  }

  return { budgetLine, remaining };
}

/**
 * Moves `amount` from "committed" into "spent" on disbursement. Call
 * this inside the same transaction as recording the payment execution.
 */
async function markSpent(client, { budgetLineId, amount }) {
  await client.query(
    'UPDATE budget_lines SET spent_to_date = spent_to_date + $1 WHERE id = $2',
    [amount, budgetLineId]
  );
}

module.exports = { assertBudgetAvailable, markSpent };
