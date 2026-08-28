const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createRequest, listRequests, getRequest } = require('../controllers/paymentRequestsController');
const { decide } = require('../controllers/approvalsController');
const { executePayment } = require('../controllers/executionsController');
const { uploadDocument } = require('../controllers/reconciliationController');
const router = express.Router();

router.use(requireAuth);

router.post('/', requireRole('staff', 'admin'), createRequest);
router.get('/', listRequests);
router.get('/:id', getRequest);

router.post('/:id/decision', requireRole('finance', 'director', 'trustee'), decide);
router.post('/:id/execute', requireRole('finance', 'admin'), executePayment);
router.post('/:id/documents', requireRole('staff', 'finance', 'admin'), uploadDocument);

module.exports = router;
