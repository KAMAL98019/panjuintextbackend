const express = require('express');
const router = express.Router();
const controller = require('../controllers/notification.controller');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

router.get('/', controller.list);
router.patch('/:id/read', controller.markRead);
router.patch('/read-all', controller.markAllRead);

module.exports = router;
