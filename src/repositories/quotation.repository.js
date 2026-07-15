const prisma = require('../config/db');

const fullInclude = {
  customer: true,
  items: { include: { product: true } },
  revisions: { orderBy: { createdAt: 'asc' } },
  order: { include: { payments: true, bills: true } },
};

function buildWhere({ search, status, quotationType, dateFrom, dateTo, hasBill }) {
  const where = {};
  if (search) {
    where.OR = [
      { quotationNumber: { contains: search } },
      { customer: { name: { contains: search } } },
      { customer: { mobile: { contains: search } } },
    ];
  }
  if (status) where.status = status;
  if (quotationType) where.quotationType = quotationType;
  // Filter by generated documents: who has a Memo / GST bill / nothing yet
  if (hasBill === 'Memo' || hasBill === 'GST') {
    where.order = { bills: { some: { billType: hasBill } } };
  } else if (hasBill === 'None') {
    where.AND = [...(where.AND || []), { OR: [{ order: null }, { order: { bills: { none: {} } } }] }];
  }
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }
  return where;
}

async function list({ search, status, quotationType, dateFrom, dateTo, hasBill, skip = 0, take = 20 }) {
  const where = buildWhere({ search, status, quotationType, dateFrom, dateTo, hasBill });
  const [rows, total] = await Promise.all([
    prisma.quotation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        customer: true,
        items: true,
        order: { include: { payments: true, bills: true } },
        revisions: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
    }),
    prisma.quotation.count({ where }),
  ]);
  return { rows, total };
}

function findById(id) {
  return prisma.quotation.findUnique({ where: { id }, include: fullInclude });
}

function findByIdRaw(id) {
  return prisma.quotation.findUnique({ where: { id } });
}

/** Creates a quotation with its line items in a single transaction. */
function createWithItems({ quotationData, items }) {
  return prisma.quotation.create({
    data: {
      ...quotationData,
      items: { create: items },
    },
    include: fullInclude,
  });
}

/** Replaces items and updates computed totals + status in one transaction. */
function updateWithItems(id, { quotationData, items }) {
  return prisma.$transaction(async (tx) => {
    await tx.quotationItem.deleteMany({ where: { quotationId: id } });
    return tx.quotation.update({
      where: { id },
      data: {
        ...quotationData,
        items: { create: items },
      },
      include: fullInclude,
    });
  });
}

function addRevision(quotationId, { previousAmount, newAmount, reason, remarks, newStatus }) {
  return prisma.$transaction(async (tx) => {
    await tx.quotationRevision.create({
      data: { quotationId, previousAmount, newAmount, reason, remarks },
    });
    return tx.quotation.update({
      where: { id: quotationId },
      data: { total: newAmount, status: newStatus || 'Revised' },
      include: fullInclude,
    });
  });
}

/**
 * Bargaining with a re-priced item list: replaces the quotation's items, updates its computed
 * totals, and logs the revision (previous total -> new total) in one transaction — the old amount
 * is never deleted, only ever appended to the history.
 */
function reviseWithItems(quotationId, { items, quotationData, previousAmount, newAmount, reason, remarks, newStatus }) {
  return prisma.$transaction(async (tx) => {
    await tx.quotationItem.deleteMany({ where: { quotationId } });
    await tx.quotationRevision.create({
      data: { quotationId, previousAmount, newAmount, reason, remarks },
    });
    return tx.quotation.update({
      where: { id: quotationId },
      data: {
        ...quotationData,
        status: newStatus || 'Revised',
        items: { create: items },
      },
      include: fullInclude,
    });
  });
}

function updateStatus(id, status) {
  return prisma.quotation.update({ where: { id }, data: { status } });
}

function updateRemarks(id, remarks) {
  return prisma.quotation.update({ where: { id }, data: { remarks } });
}

function remove(id) {
  return prisma.quotation.delete({ where: { id } });
}

module.exports = {
  list,
  findById,
  findByIdRaw,
  createWithItems,
  updateWithItems,
  addRevision,
  reviseWithItems,
  updateStatus,
  updateRemarks,
  remove,
};
