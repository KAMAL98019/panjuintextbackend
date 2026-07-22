const { body } = require('express-validator');

const applyDiscount = [
  body('newAmount').isFloat({ min: 0 }).withMessage('New amount must be 0 or greater'),
  body('reason').optional({ checkFalsy: true }).trim(),
  body('remarks').optional({ checkFalsy: true }).trim(),
];

module.exports = { applyDiscount };
