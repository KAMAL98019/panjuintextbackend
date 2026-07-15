const asyncHandler = require('../utils/asyncHandler');
const prisma = require('../config/db');

/**
 * Global search across quotations, customers and bills — powers the navbar search box.
 * Returns a few best matches of each kind so the admin can jump anywhere in two keystrokes.
 */
const global = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, data: { quotations: [], customers: [], bills: [] } });

  const [quotations, customers, bills] = await Promise.all([
    prisma.quotation.findMany({
      where: {
        OR: [
          { quotationNumber: { contains: q } },
          { customer: { name: { contains: q } } },
          { customer: { mobile: { contains: q } } },
        ],
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.customer.findMany({
      where: { OR: [{ name: { contains: q } }, { mobile: { contains: q } }, { customerCode: { contains: q } }] },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.bill.findMany({
      where: {
        OR: [
          { billNumber: { contains: q } },
          { customer: { name: { contains: q } } },
        ],
      },
      include: { customer: true, order: { include: { quotation: { include: { customer: true } } } } },
      orderBy: { generatedAt: 'desc' },
      take: 5,
    }),
  ]);

  res.json({
    success: true,
    data: {
      quotations: quotations.map((x) => ({ id: x.id, label: x.quotationNumber, sub: `${x.customer.name} · ${x.status}` })),
      customers: customers.map((x) => ({ id: x.id, label: x.name, sub: x.mobile })),
      bills: bills.map((x) => ({
        id: x.id,
        label: x.billNumber,
        sub: `${x.billType} · ${(x.customer || x.order?.quotation?.customer)?.name || ''}`,
      })),
    },
  });
});

module.exports = { global };
