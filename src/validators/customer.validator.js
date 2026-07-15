const { body } = require('express-validator');

const upsert = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('mobile').trim().notEmpty().withMessage('Mobile number is required'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Email must be valid'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('city').optional({ checkFalsy: true }).trim(),
  body('state').optional({ checkFalsy: true }).trim(),
  body('pincode').optional({ checkFalsy: true }).trim(),
  body('customerType').optional().isIn(['Individual', 'Company']),
];

module.exports = { upsert };
