const prisma = require('../config/db');

function buildWhere({ search, category, status }) {
  const where = {};
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { hsnCode: { contains: search } },
    ];
  }
  if (category) where.category = category;
  if (status) where.status = status;
  return where;
}

async function list({ search, category, status, skip = 0, take = 20 }) {
  const where = buildWhere({ search, category, status });
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.product.count({ where }),
  ]);
  return { rows, total };
}

function findById(id) {
  return prisma.product.findUnique({ where: { id } });
}

function create(data) {
  return prisma.product.create({ data });
}

function update(id, data) {
  return prisma.product.update({ where: { id }, data });
}

function remove(id) {
  return prisma.product.delete({ where: { id } });
}

function categoryCounts() {
  return prisma.product.groupBy({ by: ['category'], _count: { _all: true } });
}

module.exports = { list, findById, create, update, remove, categoryCounts };
