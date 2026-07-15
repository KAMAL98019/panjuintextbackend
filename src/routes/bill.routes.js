const express = require('express');
const router = express.Router();
const controller = require('../controllers/bill.controller');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

router.get('/', controller.listAll);
router.post('/', controller.createStandalone);
router.get('/:id/pdf', controller.downloadPdf);
router.get('/:id', controller.getOne);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
