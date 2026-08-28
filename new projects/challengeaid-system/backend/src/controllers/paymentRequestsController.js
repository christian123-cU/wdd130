const { z } = require('zod');
const db = require('../config/db');
const { query, withTransaction } = db;
const { AppError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/auditLog');
const { assertBudgetAvailable } = require('../services/budgetService');
const { getApprovalStatus } = require('../services/approvalService');
const { computeReconciliationStatus } = require('../services/reconciliationService');

const createSchema = z
  .object({
    centreId: z.string().uuid(),
    budgetLineId: z.string().uuid(),
    paymentType: z.enum(['coach_fee', 'foodstuffs', 'supplies', 'cleaning', 'other']),
    recipientName: z.string().min(1),
    recipientAccount: z.string().min(1).optional(),
    recipientPhone: z.string().min(1).optional(),
    amount: z.number().positive(),
    justification: z.string().min(1)
  })
  .refine((v) => v.recipientAccount || v.recipientPhone, {
    message: 'Provide at least one of recipientAccount or recipientPhone'
  });

// Only 'submitted' onward is visible to approvers; a request in
// 'draft' is the requester's own workspace until they submit it.
async function createRequest(req, res, next) {
  try {
    const input = createSchema.parse(req.body);

    await withTransaction(async (client) => {
      await assertBudgetAvailable(client, { budgetLineId: input.budgetLineId, amount: input.amount });

      const { rows } = await client.query(
        `INSERT INTO payment_requests
           (requester_id, centre_id, budget_line_id, payment_type, recipient_name,
            recipient_account, recipient_phone, amount, justification, status, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'submitted', now())
         RETURNING *`,
        [
          req.user.id,
          input.centreId,
          input.budgetLineId,
          input.paymentType,
          input.recipientName,
          input.recipientAccount || null,
          input.recipientPhone || null,
          input.amount,
          input.justification
        ]
      );

      await recordAudit(client, {
        requestId: rows[0].id,
        actorId: req.user.id,
        action: 'request.submitted',
        details: { amount: input.amount, paymentType: input.paymentType }
      });

      res.status(201).json(rows[0]);
    });
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid request payload', 400, err.errors));
    next(err);
  }
}

async function listRequests(req, res, next) {
  try {
    const { status, centreId, paymentType } = req.query;
    const conditions = [];
    const params = [];

    // Staff only ever see their own requests. Everyone else (Finance,
    // Director, Trustee, Admin) sees the full pipeline, per Section 10.
    if (req.user.role === 'staff') {
      params.push(req.user.id);
      conditions.push(`requester_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (centreId) {
      params.push(centreId);
      conditions.push(`centre_id = $${params.length}`);
    }
    if (paymentType) {
      params.push(paymentType);
      conditions.push(`payment_type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT * FROM payment_requests ${where} ORDER BY created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function getRequest(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query('SELECT * FROM payment_requests WHERE id = $1', [id]);
    const request = rows[0];
    if (!request) throw new AppError('Payment request not found', 404);

    if (req.user.role === 'staff' && request.requester_id !== req.user.id) {
      throw new AppError('You do not have access to this request', 403);
    }

    const approvalStatus = await getApprovalStatus(db, id);

    let reconciliation = null;
    if (['disbursed', 'reconciled'].includes(request.status)) {
      reconciliation = await computeReconciliationStatus(db, id, request.payment_type);
    }

    res.json({ ...request, approvalStatus, reconciliation });
  } catch (err) {
    next(err);
  }
}

module.exports = { createRequest, listRequests, getRequest };
