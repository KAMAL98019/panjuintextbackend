const express = require('express');
const router = express.Router();
const controller = require('../controllers/quotation.controller');
const billController = require('../controllers/bill.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { create: createValidator, update: updateValidator, revise } = require('../validators/quotation.validator');

router.use(requireAuth);

router.get('/export', controller.exportExcel);
router.get('/stats', controller.stats);
router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.get('/:id/pdf', billController.downloadQuotationPdf);
router.post('/', createValidator, validate, controller.create);
router.put('/:id', updateValidator, validate, controller.update);
router.post('/:id/revise', revise, validate, controller.revise);
router.patch('/:id/status', controller.updateStatus);
router.post('/:id/confirm', controller.confirm);
router.delete('/:id', controller.remove);

module.exports = router;
