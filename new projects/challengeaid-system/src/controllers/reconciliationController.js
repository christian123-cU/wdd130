const { z } = require('zod');
const { AppError } = require('../middleware/errorHandler');
const { attachDocument } = require('../services/reconciliationService');

const uploadSchema = z.object({
  documentType: z.enum([
    'signed_payment_form',
    'coach_acknowledgement',
    'vendor_receipt',
    'delivery_note',
    'supervisor_confirmation',
    'service_confirmation',
    'other_evidence'
  ]),
  fileUrl: z.string().min(1)
});

// Phase 1 note: fileUrl is a string reference (e.g. a path from an
// object-storage upload done client-side). Actual file upload
// handling (multipart, storage backend) is not implemented here —
// see README "Still needed".
async function uploadDocument(req, res, next) {
  try {
    const { id } = req.params;
    const input = uploadSchema.parse(req.body);

    const status = await attachDocument({
      requestId: id,
      documentType: input.documentType,
      fileUrl: input.fileUrl,
      uploadedBy: req.user.id
    });

    res.status(201).json(status);
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid document payload', 400, err.errors));
    next(err);
  }
}

module.exports = { uploadDocument };
