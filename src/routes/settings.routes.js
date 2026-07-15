const express = require('express');
const router = express.Router();
const controller = require('../controllers/settings.controller');
const requireAuth = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(requireAuth);

router.get('/', controller.get);
router.put('/', upload.single('logo'), controller.update);

module.exports = router;
