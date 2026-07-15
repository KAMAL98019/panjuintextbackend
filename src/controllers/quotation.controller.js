const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const prisma = require('../config/db');
const quotationRepository = require('../repositories/quotation.repository');
const customerRepository = require('../repositories/customer.repository');
const settingsRepository = require('../repositories/settings.repository');
const orderRepository = require('../repositories/order.repository');
const notificationRepository = require('../repositories/notification.repository');
const { generateQuotationNumber, generateOrderNumber, generateCustomerCode } = require('../services/numberGenerator');
const { calculateTotals } = require('../services/gstCalculator');
const { exportToExcel } = require('../services/excelExporter');
const { exportToCsv } = require('../services/csvExporter');
const { exportListToPdf } = require('../pdf/listPdf');
const { computePaymentStatus } = require('../services/paymentStatus');

/** Initial Price = the first quoted amount before any bargaining; Final Price = the live total. */
function withTrackingInfo(quotation) {
  const initialPrice = quotation.revisions?.[0]?.previousAmount ?? quotation.total;
  const paymentInfo = quotation.order
    ? computePaymentStatus(quotation.total, quotation.order.payments)
    : null;
  return { ...quotation, initialPrice, paymentInfo };
}

async function computeQuotationTotals({ customerId, quotationType, items }) {
  const [customer, settings] = await Promise.all([
    customerRepository.findById(customerId),
    settingsRepository.get(),
  ]);
  if (!customer) throw new ApiError(404, 'Customer not found');

  const isInterState =
    !!settings?.state && customer.state.trim().toLowerCase() !== settings.state.trim().toLowerCase();

  const totals = calculateTotals({ items, quotationType, isInterState });
  return { customer, settings, totals };
}

const { resolveOrCreateCustomer } = require('../services/customerResolver');

const list = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const { search, status, type, dateFrom, dateTo, paymentStatus, hasBill } = req.query;

  // Payment status is derived from an order's payments (not a stored column), so filtering by it
  // means fetching all DB-side matches, deriving, filtering, then paginating in memory.
  if (paymentStatus) {
    const { rows } = await quotationRepository.list({
      search, status, quotationType: type, dateFrom, dateTo, hasBill, skip: 0, take: 100000,
    });
    const filtered = rows.map(withTrackingInfo).filter((q) => q.paymentInfo?.status === paymentStatus);
    const pageRows = filtered.slice((page - 1) * limit, page * limit);
    return res.json({
      success: true,
      data: pageRows,
      pagination: { page, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit) },
    });
  }

  const { rows, total } = await quotationRepository.list({
    search,
    status,
    quotationType: type,
    dateFrom,
    dateTo,
    hasBill,
    skip: (page - 1) * limit,
    take: limit,
  });

  res.json({
    success: true,
    data: rows.map(withTrackingInfo),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

const getOne = asyncHandler(async (req, res) => {
  const quotation = await quotationRepository.findById(Number(req.params.id));
  if (!quotation) throw new ApiError(404, 'Quotation not found');

  const data = quotation.order
    ? { ...quotation, order: { ...quotation.order, paymentInfo: computePaymentStatus(quotation.total, quotation.order.payments) } }
    : quotation;

  res.json({ success: true, data });
});

const create = asyncHandler(async (req, res) => {
  const { customerId: rawCustomerId, customer, quotationType, items, remarks, terms, validityDays, expectedDelivery } = req.body;

  const customerId = await resolveOrCreateCustomer({ customerId: rawCustomerId, customer });
  const { totals } = await computeQuotationTotals({ customerId, quotationType, items });
  const settings = await settingsRepository.get();
  const quotationNumber = await generateQuotationNumber(settings?.quotationPrefix || 'QT');

  const quotation = await quotationRepository.createWithItems({
    quotationData: {
      quotationNumber,
      customerId,
      quotationType,
      status: 'Draft',
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      gstAmount: totals.gstAmount,
      total: totals.total,
      remarks,
      terms,
      validityDays: validityDays || 7,
      expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
    },
    items: totals.items.map((item) => ({
      productId: item.productId || null,
      description: item.description,
      hsnCode: item.hsnCode || null,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      discountPercent: item.discountPercent || 0,
      gstPercent: item.gstPercent || 0,
      amount: item.amount,
    })),
  });

  res.status(201).json({ success: true, data: quotation });
});

const update = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await quotationRepository.findByIdRaw(id);
  if (!existing) throw new ApiError(404, 'Quotation not found');
  if (['Confirmed', 'Cancelled'].includes(existing.status)) {
    throw new ApiError(400, `Cannot edit a quotation with status ${existing.status}`);
  }

  const { customerId, quotationType, items, remarks, terms, validityDays, expectedDelivery, status } = req.body;
  const { totals } = await computeQuotationTotals({
    customerId: customerId || existing.customerId,
    quotationType: quotationType || existing.quotationType,
    items,
  });

  const quotation = await quotationRepository.updateWithItems(id, {
    quotationData: {
      customerId: customerId || existing.customerId,
      quotationType: quotationType || existing.quotationType,
      status: status || existing.status,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      gstAmount: totals.gstAmount,
      total: totals.total,
      remarks,
      terms,
      validityDays: validityDays || existing.validityDays,
      expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : existing.expectedDelivery,
    },
    items: totals.items.map((item) => ({
      productId: item.productId || null,
      description: item.description,
      hsnCode: item.hsnCode || null,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      discountPercent: item.discountPercent || 0,
      gstPercent: item.gstPercent || 0,
      amount: item.amount,
    })),
  });

  res.json({ success: true, data: quotation });
});

/**
 * Negotiation / bargaining: append a revision row and update the live total. Old values are never
 * deleted. Accepts either a flat `newAmount` (quick negotiation), or a re-priced `items` list —
 * matching the real-world flow of bargaining over the actual product/price list, letter-pad style —
 * in which case the new total is computed fresh from those items rather than typed in directly.
 */
const revise = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { newAmount, reason, remarks, items } = req.body;

  const existing = await quotationRepository.findByIdRaw(id);
  if (!existing) throw new ApiError(404, 'Quotation not found');
  if (['Confirmed', 'Cancelled'].includes(existing.status)) {
    throw new ApiError(400, `Cannot revise a quotation with status ${existing.status}`);
  }

  if (Array.isArray(items) && items.length > 0) {
    const { totals } = await computeQuotationTotals({
      customerId: existing.customerId,
      quotationType: existing.quotationType,
      items,
    });

    const quotation = await quotationRepository.reviseWithItems(id, {
      previousAmount: existing.total,
      newAmount: totals.total,
      reason,
      remarks,
      newStatus: 'Revised',
      quotationData: {
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        gstAmount: totals.gstAmount,
        total: totals.total,
      },
      items: totals.items.map((item) => ({
        productId: item.productId || null,
        description: item.description,
        hsnCode: item.hsnCode || null,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent || 0,
        gstPercent: item.gstPercent || 0,
        amount: item.amount,
      })),
    });

    return res.json({ success: true, data: quotation });
  }

  const quotation = await quotationRepository.addRevision(id, {
    previousAmount: existing.total,
    newAmount,
    reason,
    remarks,
    newStatus: 'Revised',
  });

  res.json({ success: true, data: quotation });
});

const updateStatus = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status, notes } = req.body;
  const existing = await quotationRepository.findByIdRaw(id);
  if (!existing) throw new ApiError(404, 'Quotation not found');

  if (notes !== undefined) await quotationRepository.updateRemarks(id, notes);
  const quotation = await quotationRepository.updateStatus(id, status);

  if (status !== existing.status) {
    const customer = await customerRepository.findById(existing.customerId);
    await notificationRepository.create({
      type: 'QuotationStatusChanged',
      title: `Tracking updated: ${existing.quotationNumber}`,
      message: `${customer?.name || 'Customer'} moved from ${existing.status} to ${status}`,
      quotationId: id,
    });
  }

  res.json({ success: true, data: quotation });
});

/** Approves a quotation and auto-creates the confirmed Order. */
const confirm = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { assignedStaff, expectedCompletion } = req.body;

  const quotation = await quotationRepository.findByIdRaw(id);
  if (!quotation) throw new ApiError(404, 'Quotation not found');
  if (quotation.status === 'Cancelled') throw new ApiError(400, 'Cannot confirm a cancelled quotation');

  const existingOrder = await orderRepository.findByQuotationId(id);
  if (existingOrder) throw new ApiError(409, 'This quotation already has a confirmed order');

  const settings = await settingsRepository.get();
  const orderNumber = await generateOrderNumber(settings?.orderPrefix || 'ORD');

  await quotationRepository.updateStatus(id, 'Confirmed');
  const order = await orderRepository.create({
    orderNumber,
    quotationId: id,
    assignedStaff: assignedStaff || null,
    expectedCompletion: expectedCompletion ? new Date(expectedCompletion) : null,
    currentStatus: 'Confirmed',
  });

  const customer = await customerRepository.findById(quotation.customerId);
  await notificationRepository.create({
    type: 'QuotationStatusChanged',
    title: `Order confirmed: ${orderNumber}`,
    message: `${customer?.name || 'Customer'}'s quotation ${quotation.quotationNumber} was confirmed into an order`,
    quotationId: id,
  });

  res.status(201).json({ success: true, data: order });
});

const remove = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await quotationRepository.findByIdRaw(id);
  if (!existing) throw new ApiError(404, 'Quotation not found');
  if (existing.status === 'Confirmed') throw new ApiError(400, 'Cannot delete a confirmed quotation');

  await quotationRepository.remove(id);
  res.json({ success: true, message: 'Quotation deleted' });
});

const stats = asyncHandler(async (req, res) => {
  const [totalQuotations, approvedCount, valueAgg, memoGeneratedCount] = await Promise.all([
    prisma.quotation.count(),
    prisma.quotation.count({ where: { status: 'Confirmed' } }),
    prisma.quotation.aggregate({ _sum: { total: true } }),
    prisma.bill.count({ where: { billType: 'Memo' } }),
  ]);

  const approvedRate = totalQuotations > 0 ? Math.round((approvedCount / totalQuotations) * 100) : 0;

  res.json({
    success: true,
    data: {
      totalQuotations,
      approvedCount,
      approvedRate,
      totalValue: valueAgg._sum.total || 0,
      memoGeneratedCount,
    },
  });
});

const exportExcel = asyncHandler(async (req, res) => {
  // Exports honour the exact same filters as the on-screen list, so what you download
  // is what you were looking at.
  const { search, status, type, dateFrom, dateTo, paymentStatus, hasBill, format } = req.query;
  const { rows } = await quotationRepository.list({
    search, status, quotationType: type, dateFrom, dateTo, hasBill, skip: 0, take: 100000,
  });

  let exportRows = rows.map(withTrackingInfo);
  if (paymentStatus) exportRows = exportRows.filter((q) => q.paymentInfo?.status === paymentStatus);

  const columns = [
    { header: 'Quotation No', key: 'quotationNumber', width: 18 },
    { header: 'Customer', key: 'customerName', width: 22 },
    { header: 'Mobile', key: 'mobile', width: 14 },
    { header: 'Type', key: 'quotationType', width: 9 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Total', key: 'total', width: 12 },
    { header: 'Paid', key: 'paid', width: 12 },
    { header: 'Pending', key: 'pending', width: 12 },
    { header: 'Payment Status', key: 'paymentStatus', width: 14 },
    { header: 'Created', key: 'createdAt', width: 12 },
  ];
  const dataRows = exportRows.map((q) => ({
    quotationNumber: q.quotationNumber,
    customerName: q.customer.name,
    mobile: q.customer.mobile,
    quotationType: q.quotationType,
    status: q.status,
    total: q.total,
    paid: q.paymentInfo ? q.paymentInfo.paid : '',
    pending: q.paymentInfo ? q.paymentInfo.pending : '',
    paymentStatus: q.paymentInfo ? q.paymentInfo.status : '',
    createdAt: q.createdAt.toISOString().slice(0, 10),
  }));

  if (format === 'csv') {
    return exportToCsv(res, { filename: 'quotations.csv', columns, rows: dataRows });
  }
  if (format === 'pdf') {
    // PDF-specific layout: measured point widths and right-aligned, formatted money columns
    const fmt = (n) => (n === '' || n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    return exportListToPdf(res, {
      filename: 'quotations.pdf',
      title: 'Quotations',
      columns: [
        { header: 'Quotation No', key: 'quotationNumber', width: 66 },
        { header: 'Customer', key: 'customerName', width: 76 },
        { header: 'Mobile', key: 'mobile', width: 50 },
        { header: 'Type', key: 'quotationType', width: 32 },
        { header: 'Status', key: 'status', width: 50 },
        { header: 'Total', key: 'total', width: 50, align: 'right' },
        { header: 'Paid', key: 'paid', width: 46, align: 'right' },
        { header: 'Pending', key: 'pending', width: 50, align: 'right' },
        { header: 'Payment', key: 'paymentStatus', width: 46 },
        { header: 'Created', key: 'createdAt', width: 46 },
      ],
      rows: dataRows.map((r) => ({ ...r, total: fmt(r.total), paid: fmt(r.paid), pending: fmt(r.pending) })),
    });
  }

  await exportToExcel(res, {
    filename: 'quotations.xlsx',
    sheetName: 'Quotations',
    columns,
    rows: dataRows,
  });
});

module.exports = { list, getOne, create, update, revise, updateStatus, confirm, remove, exportExcel, stats };
