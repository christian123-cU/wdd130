const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listCentres, createCentre } = require('../controllers/centresController');
const router = express.Router();

router.get('/', requireAuth, listCentres);
router.post('/', requireAuth, requireRole('admin'), createCentre);

module.exports = router;
