const { z } = require('zod');
const { withTransaction } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/auditLog');
const { markSpent, assertBudgetAvailable } = require('../services/budgetService');

const executeSchema = z.object({
  method: z.enum(['cooperative_bank_transfer', 'mco_op_cash']),
  transactionReference: z.string().min(1)
});

/**
 * Records that Finance has actually released the funds. Only valid
 * once the request has cleared all four trustees (status =
 * 'trustee_approved'), enforcing the approve/execute separation from
 * Section 6. This is a deliberate human "last mile" step — nothing in
 * this codebase calls this endpoint automatically.
 */
async function executePayment(req, res, next) {
  try {
    const { id } = req.params;
    const input = executeSchema.parse(req.body);

    await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [id]);
      const request = rows[0];
      if (!request) throw new AppError('Payment request not found', 404);
      if (request.status !== 'trustee_approved') {
        throw new AppError(
          `Request must be fully approved by all four trustees before payment can be executed (current status: '${request.status}')`,
          409
        );
      }

      // Re-check budget at execution time too, not just at request
      // creation — other requests against the same line may have
      // been disbursed in the meantime.
      await assertBudgetAvailable(client, {
        budgetLineId: request.budget_line_id,
        amount: request.amount,
        excludeRequestId: request.id
      });

      const { rows: execRows } = await client.query(
        `INSERT INTO payment_executions (request_id, executed_by, method, transaction_reference)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [id, req.user.id, input.method, input.transactionReference]
      );

      await client.query(`UPDATE payment_requests SET status = 'disbursed' WHERE id = $1`, [id]);
      await markSpent(client, { budgetLineId: request.budget_line_id, amount: request.amount });

      await recordAudit(client, {
        requestId: id,
        actorId: req.user.id,
        action: 'payment.executed',
        details: { method: input.method, transactionReference: input.transactionReference }
      });

      res.status(201).json(execRows[0]);
    });
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid execution payload', 400, err.errors));
    next(err);
  }
}

module.exports = { executePayment };
