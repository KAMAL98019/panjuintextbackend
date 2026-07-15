const express = require('express');
const router = express.Router();
const controller = require('../controllers/search.controller');
const requireAuth = require('../middleware/auth');

router.get('/', requireAuth, controller.global);

module.exports = router;
