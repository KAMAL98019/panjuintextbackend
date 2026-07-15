const prisma = require('../config/db');

function listByOrder(orderId) {
  return prisma.payment.findMany({ where: { orderId }, orderBy: { paymentDate: 'asc' } });
}

function create(data) {
  return prisma.payment.create({ data });
}

module.exports = { listByOrder, create };
