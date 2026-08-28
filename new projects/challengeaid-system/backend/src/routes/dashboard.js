const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { summary, aging } = require('../controllers/dashboardController');
const router = express.Router();

router.use(requireAuth, requireRole('director', 'trustee', 'admin', 'finance'));
router.get('/summary', summary);
router.get('/aging', aging);

module.exports = router;
