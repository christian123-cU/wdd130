/**
 * Writes one audit_log row. Pass `client` when called inside an
 * existing transaction so the audit entry commits/rolls back with
 * the action it describes; falls back to the pool otherwise.
 */
async function recordAudit(clientOrPool, { requestId = null, actorId = null, action, details = null }) {
  await clientOrPool.query(
    `INSERT INTO audit_log (request_id, actor_id, action, details)
     VALUES ($1, $2, $3, $4)`,
    [requestId, actorId, action, details ? JSON.stringify(details) : null]
  );
}

module.exports = { recordAudit };
