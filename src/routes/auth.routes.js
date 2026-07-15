const express = require('express');
const router = express.Router();
const controller = require('../controllers/auth.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { login, resetPassword } = require('../validators/auth.validator');

router.post('/login', login, validate, controller.login);
router.get('/me', requireAuth, controller.me);
router.post('/reset-password', requireAuth, resetPassword, validate, controller.resetPassword);

module.exports = router;
