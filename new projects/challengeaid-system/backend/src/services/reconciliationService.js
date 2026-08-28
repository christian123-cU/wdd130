const { withTransaction } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/auditLog');

// Required document types per payment type, per Section 7 of the design doc.
const REQUIRED_DOCS = {
  coach_fee: ['signed_payment_form', 'coach_acknowledgement'],
  foodstuffs: ['signed_payment_form', 'vendor_receipt', 'delivery_note'],
  supplies: ['signed_payment_form', 'vendor_receipt'],
  cleaning: ['signed_payment_form', 'service_confirmation'],
  // "Additional evidence at Finance's discretion" — the signed form is
  // the only hard requirement; anything under 'other_evidence' is optional
  // and doesn't block reconciliation on its own.
  other: ['signed_payment_form']
};

function requiredDocsFor(paymentType) {
  const docs = REQUIRED_DOCS[paymentType];
  if (!docs) throw new AppError(`Unknown payment type '${paymentType}'`, 400);
  return docs;
}

/**
 * Attaches one reconciliation document to a request, then recomputes
 * whether the request is now fully reconciled. A request must already
 * be 'disbursed' (or already 'reconciled', for late corrections) before
 * documents can be attached — uploading docs against a request that
 * hasn't been paid yet doesn't make sense.
 */
async function attachDocument({ requestId, documentType, fileUrl, uploadedBy }) {
  return withTransaction(async (client) => {
    const { rows: reqRows } = await client.query(
      'SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE',
      [requestId]
    );
    const request = reqRows[0];
    if (!request) throw new AppError('Payment request not found', 404);
    if (!['disbursed', 'reconciled'].includes(request.status)) {
      throw new AppError(
        `Reconciliation documents can only be uploaded after disbursement (current status: '${request.status}')`,
        409
      );
    }

    await client.query(
      `INSERT INTO reconciliation_docs (request_id, document_type, file_url, uploaded_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (request_id, document_type)
       DO UPDATE SET file_url = EXCLUDED.file_url, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`,
      [requestId, documentType, fileUrl, uploadedBy]
    );

    const status = await computeReconciliationStatus(client, requestId, request.payment_type);

    if (status.isReconciled && request.status !== 'reconciled') {
      await client.query(`UPDATE payment_requests SET status = 'reconciled' WHERE id = $1`, [requestId]);
      await recordAudit(client, {
        requestId,
        actorId: uploadedBy,
        action: 'reconciliation.completed',
        details: { documentType }
      });
    } else {
      await recordAudit(client, {
        requestId,
        actorId: uploadedBy,
        action: 'reconciliation.document_uploaded',
        details: { documentType, stillMissing: status.missing }
      });
    }

    return status;
  });
}

/**
 * Computes reconciliation status for a request: which required docs
 * are present/missing, and whether it's fully reconciled.
 */
async function computeReconciliationStatus(client, requestId, paymentType) {
  const required = requiredDocsFor(paymentType);
  const { rows } = await client.query(
    'SELECT document_type FROM reconciliation_docs WHERE request_id = $1',
    [requestId]
  );
  const present = new Set(rows.map((r) => r.document_type));
  const missing = required.filter((doc) => !present.has(doc));

  return {
    requestId,
    paymentType,
    required,
    present: [...present],
    missing,
    isReconciled: missing.length === 0,
    statusLabel: missing.length === 0 ? 'Reconciled' : `Pending — Missing ${missing.join(', ')}`
  };
}

module.exports = { attachDocument, computeReconciliationStatus, requiredDocsFor, REQUIRED_DOCS };
