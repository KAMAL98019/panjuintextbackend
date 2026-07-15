const asyncHandler = require('../utils/asyncHandler');
const prisma = require('../config/db');
const { computePaymentStatus } = require('../services/paymentStatus');

const stats = asyncHandler(async (req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [
    totalCustomers,
    activeQuotations,
    todaysQuotations,
    confirmedOrders,
    ordersWithPayments,
    recentCustomers,
    recentQuotations,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.quotation.count({ where: { status: { in: ['Draft', 'Sent', 'UnderNegotiation', 'Revised'] } } }),
    prisma.quotation.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.order.count(),
    prisma.order.findMany({
      where: { createdAt: { gte: startOfMonth } },
      include: { quotation: true, payments: true },
    }),
    prisma.customer.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.quotation.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { customer: true } }),
  ]);

  let monthlyCollections = 0;
  let pendingPayments = 0;
  ordersWithPayments.forEach((order) => {
    const { paid, pending } = computePaymentStatus(order.quotation.total, order.payments);
    monthlyCollections += paid;
    pendingPayments += pending;
  });

  const todaysCollections = await prisma.payment.aggregate({
    _sum: { amount: true },
    where: { paymentDate: { gte: startOfToday } },
  });

  // "Needs attention" work queues: money still to collect, confirmed orders with no bill yet,
  // and quotations sitting in negotiation — the admin's actual to-do list.
  const allOrders = await prisma.order.findMany({
    include: { quotation: { include: { customer: true } }, payments: true, bills: true },
    orderBy: { createdAt: 'desc' },
  });

  const paymentsDue = allOrders
    .map((order) => ({ order, info: computePaymentStatus(order.quotation.total, order.payments) }))
    .filter(({ info }) => info.pending > 0)
    .slice(0, 5)
    .map(({ order, info }) => ({
      quotationId: order.quotationId,
      orderNumber: order.orderNumber,
      customerName: order.quotation.customer.name,
      pending: info.pending,
    }));

  const unbilledOrders = allOrders
    .filter((order) => order.bills.length === 0)
    .slice(0, 5)
    .map((order) => ({
      quotationId: order.quotationId,
      orderNumber: order.orderNumber,
      orderId: order.id,
      customerName: order.quotation.customer.name,
      total: order.quotation.total,
    }));

  const openQuotations = await prisma.quotation.findMany({
    where: { status: { in: ['Draft', 'Sent', 'UnderNegotiation', 'Revised'] } },
    include: { customer: true },
    orderBy: { updatedAt: 'asc' },
    take: 5,
  });

  res.json({
    success: true,
    data: {
      totalCustomers,
      activeQuotations,
      todaysQuotations,
      confirmedOrders,
      monthlyCollections,
      pendingPayments,
      todaysCollections: todaysCollections._sum.amount || 0,
      recentCustomers,
      recentQuotations,
      attention: {
        paymentsDue,
        unbilledOrders,
        openQuotations: openQuotations.map((x) => ({
          id: x.id,
          quotationNumber: x.quotationNumber,
          customerName: x.customer.name,
          status: x.status,
          total: x.total,
        })),
      },
    },
  });
});

/** 6-month revenue trend (quoted value vs. actually collected) + current quotation status mix, for dashboard charts. */
const analytics = asyncHandler(async (req, res) => {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [quotations, payments, statusGroups] = await Promise.all([
    prisma.quotation.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true, total: true },
    }),
    prisma.payment.findMany({
      where: { paymentDate: { gte: sixMonthsAgo } },
      select: { paymentDate: true, amount: true },
    }),
    prisma.quotation.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const monthKey = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${d.getMonth()}`;
  };

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, month: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), quoted: 0, collected: 0 });
  }
  const monthMap = Object.fromEntries(months.map((m) => [m.key, m]));

  quotations.forEach((q) => {
    const m = monthMap[monthKey(q.createdAt)];
    if (m) m.quoted += q.total;
  });
  payments.forEach((p) => {
    const m = monthMap[monthKey(p.paymentDate)];
    if (m) m.collected += p.amount;
  });

  const statusBreakdown = statusGroups.map((g) => ({ status: g.status, count: g._count._all }));

  res.json({
    success: true,
    data: {
      revenueTrend: months.map(({ key, ...rest }) => rest),
      statusBreakdown,
    },
  });
});

module.exports = { stats, analytics };
