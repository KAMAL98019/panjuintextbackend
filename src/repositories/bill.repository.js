const prisma = require('../config/db');

const fullInclude = {
  customer: true,
  order: { include: { quotation: { include: { customer: true } } } },
};

function create(data) {
  return prisma.bill.create({ data, include: fullInclude });
}

function findById(id) {
  return prisma.bill.findUnique({ where: { id }, include: fullInclude });
}

function listByOrder(orderId) {
  return prisma.bill.findMany({ where: { orderId }, orderBy: { generatedAt: 'desc' } });
}

async function list({ billType, search, skip = 0, take = 20 }) {
  const where = {};
  if (billType) where.billType = billType;
  if (search) {
    where.OR = [
      { billNumber: { contains: search } },
      { customer: { name: { contains: search } } },
      { customer: { mobile: { contains: search } } },
      { order: { quotation: { customer: { name: { contains: search } } } } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.bill.findMany({ where, orderBy: { generatedAt: 'desc' }, skip, take, include: fullInclude }),
    prisma.bill.count({ where }),
  ]);
  return { rows, total };
}

function update(id, data) {
  return prisma.bill.update({ where: { id }, data, include: fullInclude });
}

function remove(id) {
  return prisma.bill.delete({ where: { id } });
}

module.exports = { create, findById, listByOrder, list, update, remove };
