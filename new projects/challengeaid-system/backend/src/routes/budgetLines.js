const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listBudgetLines, createBudgetLine } = require('../controllers/budgetLinesController');
const router = express.Router();

router.get('/', requireAuth, listBudgetLines);
router.post('/', requireAuth, requireRole('admin', 'finance'), createBudgetLine);

module.exports = router;
