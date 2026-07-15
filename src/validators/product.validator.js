const { body } = require('express-validator');

const CATEGORIES = [
  'MosquitoNet', 'Curtains', 'Wallpaper', 'WallSticker', 'Blinds', 'Accessories', 'Installation', 'Other',
];

const upsert = [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('category').isIn(CATEGORIES).withMessage('Invalid category'),
  body('unit').trim().notEmpty().withMessage('Unit is required'),
  body('gstPercent').isFloat({ min: 0, max: 100 }).withMessage('GST % must be between 0 and 100'),
  body('defaultRate').isFloat({ min: 0 }).withMessage('Default rate must be a positive number'),
  body('status').optional().isIn(['Active', 'Inactive']),
];

module.exports = { upsert, CATEGORIES };
