const prisma = require('../config/db');

function buildWhere({ search }) {
  if (!search) return {};
  return {
    OR: [
      { name: { contains: search } },
      { mobile: { contains: search } },
      { email: { contains: search } },
      { customerCode: { contains: search } },
    ],
  };
}

async function list({ search, skip = 0, take = 20 }) {
  const where = buildWhere({ search });
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { _count: { select: { quotations: true } } },
    }),
    prisma.customer.count({ where }),
  ]);
  return { rows, total };
}

function findById(id) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      quotations: {
        orderBy: { createdAt: 'desc' },
        include: { order: true },
      },
    },
  });
}

function findByMobile(mobile) {
  return prisma.customer.findFirst({ where: { mobile } });
}

function create(data) {
  return prisma.customer.create({ data });
}

function update(id, data) {
  return prisma.customer.update({ where: { id }, data });
}

function remove(id) {
  return prisma.customer.delete({ where: { id } });
}

function summary(id) {
  return prisma.quotation.findMany({
    where: { customerId: id },
    select: { status: true, total: true },
  });
}

module.exports = { list, findById, findByMobile, create, update, remove, summary };
