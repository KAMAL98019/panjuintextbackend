const express = require('express');
const router = express.Router();
const controller = require('../controllers/dashboard.controller');
const requireAuth = require('../middleware/auth');

router.get('/stats', requireAuth, controller.stats);
router.get('/analytics', requireAuth, controller.analytics);

module.exports = router;
