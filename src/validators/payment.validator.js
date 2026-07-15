const { body } = require('express-validator');

const create = [
  body('type').isIn(['Advance', 'Partial', 'Final']).withMessage('Invalid payment type'),
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
  body('paymentMode').trim().notEmpty().withMessage('Payment mode is required'),
];

module.exports = { create };
