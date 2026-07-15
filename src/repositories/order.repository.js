const prisma = require('../config/db');

const fullInclude = {
  quotation: { include: { customer: true, items: true } },
  payments: { orderBy: { paymentDate: 'asc' } },
  bills: { orderBy: { generatedAt: 'desc' } },
};

function buildWhere({ search, status }) {
  const where = {};
  if (search) {
    where.OR = [
      { orderNumber: { contains: search } },
      { quotation: { quotationNumber: { contains: search } } },
      { quotation: { customer: { name: { contains: search } } } },
    ];
  }
  if (status) where.currentStatus = status;
  return where;
}

async function list({ search, status, skip = 0, take = 20 }) {
  const where = buildWhere({ search, status });
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: fullInclude,
    }),
    prisma.order.count({ where }),
  ]);
  return { rows, total };
}

function findById(id) {
  return prisma.order.findUnique({ where: { id }, include: fullInclude });
}

function findByQuotationId(quotationId) {
  return prisma.order.findUnique({ where: { quotationId }, include: fullInclude });
}

function create(data) {
  return prisma.order.create({ data, include: fullInclude });
}

function updateStatus(id, currentStatus) {
  return prisma.order.update({ where: { id }, data: { currentStatus }, include: fullInclude });
}

function update(id, data) {
  return prisma.order.update({ where: { id }, data, include: fullInclude });
}

module.exports = { list, findById, findByQuotationId, create, updateStatus, update };
