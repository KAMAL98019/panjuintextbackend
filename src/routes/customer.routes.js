const express = require('express');
const router = express.Router();
const controller = require('../controllers/customer.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { upsert } = require('../validators/customer.validator');

router.use(requireAuth);

router.get('/export', controller.exportExcel);
router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/', upsert, validate, controller.create);
router.put('/:id', upsert, validate, controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
