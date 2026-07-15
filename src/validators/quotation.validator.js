const { body } = require('express-validator');

/** Either an existing customerId, or an inline customer object to create/reuse (matched by mobile).
 * Only name/mobile/address are required — city/state/pincode default server-side (state falls back
 * to the company's own state, keeping GST intra-state by default). */
const customerReference = [
  body().custom((value) => {
    if (value.customerId) return true;
    const c = value.customer;
    if (!c || !c.name || !c.mobile || !c.address) {
      throw new Error('Provide an existing customerId or new-customer details (name, mobile, address)');
    }
    return true;
  }),
];

const create = [
  ...customerReference,
  body('quotationType').isIn(['GST', 'NonGST']).withMessage('quotationType must be GST or NonGST'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.description').trim().notEmpty().withMessage('Item description is required'),
  body('items.*.quantity').isFloat({ gt: 0 }).withMessage('Item quantity must be greater than 0'),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Item unit price must be a positive number'),
];

const update = [
  body('customerId').isInt({ min: 1 }).withMessage('customerId is required'),
  body('quotationType').isIn(['GST', 'NonGST']).withMessage('quotationType must be GST or NonGST'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.description').trim().notEmpty().withMessage('Item description is required'),
  body('items.*.quantity').isFloat({ gt: 0 }).withMessage('Item quantity must be greater than 0'),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Item unit price must be a positive number'),
];

const revise = [
  body().custom((value) => {
    const hasItems = Array.isArray(value.items) && value.items.length > 0;
    const hasAmount = value.newAmount !== undefined && value.newAmount !== null && Number(value.newAmount) > 0;
    if (!hasItems && !hasAmount) {
      throw new Error('Provide either a re-priced items list or a newAmount greater than 0');
    }
    return true;
  }),
  body('items.*.description').if(body('items').exists()).trim().notEmpty().withMessage('Item description is required'),
  body('items.*.quantity').if(body('items').exists()).isFloat({ gt: 0 }).withMessage('Item quantity must be greater than 0'),
  body('items.*.unitPrice').if(body('items').exists()).isFloat({ min: 0 }).withMessage('Item unit price must be a positive number'),
  body('reason').optional().isString(),
  body('remarks').optional().isString(),
];

module.exports = { create, update, revise };
