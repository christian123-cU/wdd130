const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listUsers, createUser, deactivateUser } = require('../controllers/usersController');
const router = express.Router();

router.use(requireAuth, requireRole('admin'));
router.get('/', listUsers);
router.post('/', createUser);
router.delete('/:id', deactivateUser);

module.exports = router;
