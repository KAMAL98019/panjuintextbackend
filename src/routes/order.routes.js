const express = require('express');
const router = express.Router();
const controller = require('../controllers/order.controller');
const paymentController = require('../controllers/payment.controller');
const billController = require('../controllers/bill.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { create: createPaymentValidator } = require('../validators/payment.validator');

router.use(requireAuth);

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.put('/:id', controller.update);
router.patch('/:id/status', controller.updateStatus);
router.patch('/:id/tracking', controller.updateTracking);

router.get('/:orderId/payments', paymentController.list);
router.post('/:orderId/payments', createPaymentValidator, validate, paymentController.create);

router.get('/:orderId/bills', billController.list);
router.post('/:orderId/bills', billController.create);

module.exports = router;
