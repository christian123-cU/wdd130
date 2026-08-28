const { withTransaction } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/auditLog');

const TRUSTEES_REQUIRED = 4;

// Maps a role to the stage it acts at. Only these roles may approve.
const ROLE_TO_STAGE = {
  finance: 'finance',
  director: 'director',
  trustee: 'trustee'
};

// The order a request must move through. A stage can only be acted
// on once every earlier stage has an 'approved' decision recorded
// (and, for trustee, once all four trustees have approved).
const STAGE_ORDER = ['finance', 'director', 'trustee'];

/**
 * Returns the request row, or throws 404.
 */
async function getRequestOrThrow(client, requestId) {
  const { rows } = await client.query('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [requestId]);
  if (!rows[0]) throw new AppError('Payment request not found', 404);
  return rows[0];
}

/**
 * Validates that `stage` is allowed to act right now, given the
 * request's current status and the approvals already recorded.
 * Throws AppError if the sequence would be violated.
 */
function assertStageIsUnlocked(stage, currentStatus) {
  const blockedStatuses = ['rejected', 'disbursed', 'reconciled'];
  if (blockedStatuses.includes(currentStatus)) {
    throw new AppError(`Request is already ${currentStatus} and cannot receive further approvals`, 409);
  }

  const stageIndex = STAGE_ORDER.indexOf(stage);
  const statusOrder = ['submitted', 'finance_approved', 'director_approved', 'trustee_approved'];
  const currentIndex = statusOrder.indexOf(currentStatus);

  // A stage can act if all *earlier* stages are already cleared.
  // finance (index 0) acts on 'submitted' or 'more_info_requested'.
  // director (index 1) acts once status is 'finance_approved'.
  // trustee (index 2) acts once status is 'director_approved' (individual
  // trustees keep acting while status stays 'director_approved' until 4/4).
  if (stage === 'finance') {
    if (!['submitted', 'more_info_requested'].includes(currentStatus)) {
      throw new AppError(`Finance cannot act on a request with status '${currentStatus}'`, 409);
    }
  } else if (stage === 'director') {
    if (currentStatus !== 'finance_approved') {
      throw new AppError(`Director cannot act before Finance has approved (current status: '${currentStatus}')`, 409);
    }
  } else if (stage === 'trustee') {
    if (currentStatus !== 'director_approved') {
      throw new AppError(`Trustees cannot act before the Director has approved (current status: '${currentStatus}')`, 409);
    }
  }

  return stageIndex >= 0;
}

/**
 * Records one approver's decision on one request and advances the
 * request's status accordingly. Enforces:
 *  - correct sequence (Finance -> Director -> all 4 Trustees)
 *  - one decision per approver per stage per request (DB UNIQUE backs this up)
 *  - rejection/more-info short-circuits the workflow
 */
async function recordApprovalDecision({ requestId, approver, decision, comments }) {
  const stage = ROLE_TO_STAGE[approver.role];
  if (!stage) {
    throw new AppError(`Role '${approver.role}' is not an approval role`, 403);
  }

  return withTransaction(async (client) => {
    const request = await getRequestOrThrow(client, requestId);
    assertStageIsUnlocked(stage, request.status);

    // Prevent a duplicate decision from the same approver at this stage
    // (belt-and-braces on top of the DB UNIQUE constraint, so we can
    // return a clean 409 instead of a raw constraint-violation error).
    const existing = await client.query(
      `SELECT id FROM approvals WHERE request_id = $1 AND approver_id = $2 AND stage = $3`,
      [requestId, approver.id, stage]
    );
    if (existing.rows[0]) {
      throw new AppError('You have already recorded a decision for this stage on this request', 409);
    }

    await client.query(
      `INSERT INTO approvals (request_id, approver_id, stage, decision, comments)
       VALUES ($1, $2, $3, $4, $5)`,
      [requestId, approver.id, stage, decision, comments || null]
    );

    let newStatus = request.status;

    if (decision === 'rejected') {
      newStatus = 'rejected';
    } else if (decision === 'more_info_requested') {
      newStatus = 'more_info_requested';
    } else if (decision === 'approved') {
      if (stage === 'finance') {
        newStatus = 'finance_approved';
      } else if (stage === 'director') {
        newStatus = 'director_approved';
      } else if (stage === 'trustee') {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS count FROM approvals
           WHERE request_id = $1 AND stage = 'trustee' AND decision = 'approved'`,
          [requestId]
        );
        newStatus = rows[0].count >= TRUSTEES_REQUIRED ? 'trustee_approved' : 'director_approved';
      }
    }

    await client.query(
      `UPDATE payment_requests
       SET status = $1, rejection_reason = CASE WHEN $1 = 'rejected' THEN $2 ELSE rejection_reason END
       WHERE id = $3`,
      [newStatus, decision === 'rejected' ? comments || null : null, requestId]
    );

    await recordAudit(client, {
      requestId,
      actorId: approver.id,
      action: `approval.${stage}.${decision}`,
      details: { comments: comments || null, resultingStatus: newStatus }
    });

    const { rows: trusteeRows } = await client.query(
      `SELECT approver_id, decision, comments, created_at FROM approvals
       WHERE request_id = $1 AND stage = 'trustee' ORDER BY created_at`,
      [requestId]
    );

    return {
      requestId,
      status: newStatus,
      trusteeApprovalsSoFar: trusteeRows.filter((r) => r.decision === 'approved').length,
      trusteesRequired: TRUSTEES_REQUIRED,
      trusteeApprovals: trusteeRows
    };
  });
}

/**
 * Returns the full approval status for a request: which stages are
 * cleared and, for trustees, which of the four have signed.
 */
async function getApprovalStatus(client, requestId) {
  const { rows } = await client.query(
    `SELECT a.*, u.name AS approver_name, u.role AS approver_role
     FROM approvals a JOIN users u ON u.id = a.approver_id
     WHERE a.request_id = $1 ORDER BY a.created_at`,
    [requestId]
  );

  const trusteeApprovals = rows.filter((r) => r.stage === 'trustee' && r.decision === 'approved');

  return {
    all: rows,
    financeDecision: rows.find((r) => r.stage === 'finance') || null,
    directorDecision: rows.find((r) => r.stage === 'director') || null,
    trusteeApprovalsCount: trusteeApprovals.length,
    trusteesRequired: TRUSTEES_REQUIRED,
    trusteeApprovals
  };
}

module.exports = { recordApprovalDecision, getApprovalStatus, TRUSTEES_REQUIRED };
