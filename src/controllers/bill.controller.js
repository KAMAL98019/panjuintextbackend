const PDFDocument = require('pdfkit');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const billRepository = require('../repositories/bill.repository');
const orderRepository = require('../repositories/order.repository');
const paymentRepository = require('../repositories/payment.repository');
const settingsRepository = require('../repositories/settings.repository');
const customerRepository = require('../repositories/customer.repository');
const { generateBillNumber } = require('../services/numberGenerator');
const { computePaymentStatus } = require('../services/paymentStatus');
const { calculateTotals, round2 } = require('../services/gstCalculator');
const { renderGstBillPdf } = require('../pdf/gstBillPdf');
const { renderMemoBillPdf } = require('../pdf/memoBillPdf');
const { renderQuotationPdf } = require('../pdf/quotationPdf');

const { resolveOrCreateCustomer } = require('../services/customerResolver');

/** A bill's customer: direct link for standalone bills, via the order's quotation otherwise. */
function billCustomerOf(bill) {
  return bill.customer || bill.order?.quotation?.customer || null;
}

const list = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.orderId);
  const bills = await billRepository.listByOrder(orderId);
  res.json({ success: true, data: bills });
});

/** All bills (Memo + GST), standalone and order-linked, for the Bills page. */
const listAll = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const { billType, search } = req.query;

  const { rows, total } = await billRepository.list({
    billType: billType || undefined,
    search,
    skip: (page - 1) * limit,
    take: limit,
  });

  const data = rows.map((bill) => {
    const snapshot = JSON.parse(bill.snapshotJson);
    return {
      id: bill.id,
      billNumber: bill.billNumber,
      billType: bill.billType,
      generatedAt: bill.generatedAt,
      orderId: bill.orderId,
      customer: billCustomerOf(bill),
      total: snapshot.quotation?.total ?? 0,
      paymentInfo: snapshot.paymentInfo || null,
    };
  });

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

const getOne = asyncHandler(async (req, res) => {
  const bill = await billRepository.findById(Number(req.params.id));
  if (!bill) throw new ApiError(404, 'Bill not found');
  const snapshot = JSON.parse(bill.snapshotJson);
  res.json({ success: true, data: { ...bill, snapshot, customer: billCustomerOf(bill) } });
});

/**
 * Builds the frozen item list + totals for a bill snapshot. If the admin filled in items from
 * scratch on the bill form (rather than accepting the quotation's items as-is — e.g. the physical
 * Memo/Tax Invoice pad often differs slightly from the quotation, with its own Shade Code column),
 * those custom items and their own computed totals are used instead. GST bills recompute proper
 * CGST/SGST vs IGST from the customer's state; Memo bills are flat (no tax), matching the pad.
 */
function buildBillContent({ billType, order, customItems }) {
  if (!Array.isArray(customItems) || customItems.length === 0) {
    return {
      items: order.quotation.items,
      subtotal: order.quotation.subtotal,
      discountAmount: order.quotation.discountAmount,
      cgst: order.quotation.cgst,
      sgst: order.quotation.sgst,
      igst: order.quotation.igst,
      gstAmount: order.quotation.gstAmount,
      total: order.quotation.total,
    };
  }

  if (billType === 'GST') {
    const calc = calculateTotals({ items: customItems, quotationType: 'GST', isInterState: order.isInterState });
    return {
      items: calc.items,
      subtotal: calc.subtotal,
      discountAmount: calc.discountAmount,
      cgst: calc.cgst,
      sgst: calc.sgst,
      igst: calc.igst,
      gstAmount: calc.gstAmount,
      total: calc.total,
    };
  }

  // Memo: flat pricing like the physical pad, with GST optionally added per line
  // (0% by default — the line amount simply includes it when set).
  let subtotal = 0;
  const items = customItems.map((item) => {
    const base = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
    const amount = round2(base * (1 + (Number(item.gstPercent) || 0) / 100));
    subtotal += amount;
    return { ...item, amount };
  });
  return { items, subtotal: round2(subtotal), discountAmount: 0, cgst: 0, sgst: 0, igst: 0, gstAmount: 0, total: round2(subtotal) };
}

/**
 * Generates (or re-uses) a Memo or GST bill for an order, freezing a snapshot of items+totals
 * plus any bill-specific customization fields (e.g. Memo's delivery date/execution period, or the
 * GST invoice's transport/vehicle details) so a reprint always shows exactly what was issued.
 */
const create = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.orderId);
  const { billType, customFields, items: customItems } = req.body;
  if (!['Memo', 'GST'].includes(billType)) throw new ApiError(422, 'Invalid bill type');

  const order = await orderRepository.findById(orderId);
  if (!order) throw new ApiError(404, 'Order not found');

  const settings = await settingsRepository.get();
  const isInterState = !!settings?.state && order.quotation.customer.state.trim().toLowerCase() !== settings.state.trim().toLowerCase();
  const content = buildBillContent({ billType, order: { ...order, isInterState }, customItems });

  const payments = await paymentRepository.listByOrder(orderId);
  const paymentInfo = computePaymentStatus(content.total, payments);

  const billNumber = await generateBillNumber(
    billType === 'Memo' ? settings?.memoPrefix || 'MEMO' : settings?.invoicePrefix || 'INV',
    billType
  );

  const snapshot = {
    quotation: {
      quotationNumber: order.quotation.quotationNumber,
      quotationType: order.quotation.quotationType,
      subtotal: content.subtotal,
      discountAmount: content.discountAmount,
      cgst: content.cgst,
      sgst: content.sgst,
      igst: content.igst,
      gstAmount: content.gstAmount,
      total: content.total,
      remarks: order.quotation.remarks,
      items: content.items,
    },
    paymentInfo,
    customFields: customFields || {},
  };

  const bill = await billRepository.create({
    billNumber,
    orderId,
    customerId: order.quotation.customerId,
    billType,
    snapshotJson: JSON.stringify(snapshot),
  });

  res.status(201).json({ success: true, data: bill });
});

/** Payment block for standalone bills: the admin types the advance straight on the form, like the pad. */
function standalonePaymentInfo(total, customFields) {
  const paid = Number(customFields?.advancePayment) || 0;
  const pending = Math.max(total - paid, 0);
  return { paid, pending, status: pending <= 0 ? 'Fully Paid' : paid > 0 ? 'Partially Paid' : 'Pending' };
}

/** Builds the frozen snapshot for a standalone (no-order) bill from form items + fields. */
async function buildStandaloneSnapshot({ billType, customer, items, customFields }) {
  const settings = await settingsRepository.get();
  const isInterState = !!settings?.state && !!customer.state &&
    customer.state.trim().toLowerCase() !== settings.state.trim().toLowerCase();
  const content = buildBillContent({ billType, order: { isInterState, quotation: { items: [] } }, customItems: items });
  return {
    quotation: {
      quotationNumber: null,
      quotationType: billType === 'GST' ? 'GST' : 'NonGST',
      subtotal: content.subtotal,
      discountAmount: content.discountAmount,
      cgst: content.cgst,
      sgst: content.sgst,
      igst: content.igst,
      gstAmount: content.gstAmount,
      total: content.total,
      remarks: customFields?.remarks || null,
      items: content.items,
    },
    paymentInfo: standalonePaymentInfo(content.total, customFields),
    customFields: customFields || {},
  };
}

/**
 * Standalone bill creation — a Memo or GST bill written directly for a person, like tearing a
 * sheet off the physical pad, no quotation/order required.
 */
const createStandalone = asyncHandler(async (req, res) => {
  const { billType, customerId, customer, items, customFields } = req.body;
  if (!['Memo', 'GST'].includes(billType)) throw new ApiError(422, 'Invalid bill type');
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(422, 'At least one item is required');
  if (!customerId && !(customer?.name && customer?.mobile)) {
    throw new ApiError(422, 'Select a customer or provide new-customer name and mobile');
  }

  const resolvedCustomerId = await resolveOrCreateCustomer({ customerId, customer });
  const fullCustomer = await customerRepository.findById(resolvedCustomerId);

  const settings = await settingsRepository.get();
  const snapshot = await buildStandaloneSnapshot({ billType, customer: fullCustomer, items, customFields });
  const billNumber = await generateBillNumber(
    billType === 'Memo' ? settings?.memoPrefix || 'MEMO' : settings?.invoicePrefix || 'INV',
    billType
  );

  const bill = await billRepository.create({
    billNumber,
    customerId: resolvedCustomerId,
    billType,
    snapshotJson: JSON.stringify(snapshot),
  });

  res.status(201).json({ success: true, data: bill });
});

/** Edits a bill in place — same bill number, rebuilt snapshot (items, fields, customer). */
const update = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { customerId, items, customFields } = req.body;

  const existing = await billRepository.findById(id);
  if (!existing) throw new ApiError(404, 'Bill not found');
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(422, 'At least one item is required');

  const targetCustomerId = customerId ? Number(customerId) : (existing.customerId || existing.order?.quotation?.customerId);
  const fullCustomer = await customerRepository.findById(targetCustomerId);
  if (!fullCustomer) throw new ApiError(422, 'Bill has no customer to bill against');

  const snapshot = await buildStandaloneSnapshot({ billType: existing.billType, customer: fullCustomer, items, customFields });

  // Order-linked bills keep their real payment ledger in the snapshot
  if (existing.orderId) {
    const payments = await paymentRepository.listByOrder(existing.orderId);
    snapshot.paymentInfo = computePaymentStatus(snapshot.quotation.total, payments);
  }

  const bill = await billRepository.update(id, {
    customerId: targetCustomerId,
    snapshotJson: JSON.stringify(snapshot),
  });

  res.json({ success: true, data: bill });
});

const remove = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await billRepository.findById(id);
  if (!existing) throw new ApiError(404, 'Bill not found');
  await billRepository.remove(id);
  res.json({ success: true, message: 'Bill deleted' });
});

/** Streams the frozen bill snapshot as a PDF — never drifts from what was actually issued. */
const downloadPdf = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const bill = await billRepository.findById(id);
  if (!bill) throw new ApiError(404, 'Bill not found');

  const settings = await settingsRepository.get();
  const customer = billCustomerOf(bill);
  const snapshot = JSON.parse(bill.snapshotJson);

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${bill.billNumber}.pdf"`);
  doc.pipe(res);

  const context = {
    company: settings,
    customer,
    order: bill.order,
    quotation: snapshot.quotation,
    bill,
    paymentInfo: snapshot.paymentInfo,
    customFields: snapshot.customFields || {},
  };

  if (bill.billType === 'GST') renderGstBillPdf(doc, context);
  else renderMemoBillPdf(doc, context);

  doc.end();
});

/** Streams a printable pre-order quotation PDF directly from the live quotation record. */
const downloadQuotationPdf = asyncHandler(async (req, res) => {
  const quotationRepository = require('../repositories/quotation.repository');
  const id = Number(req.params.id);
  const quotation = await quotationRepository.findById(id);
  if (!quotation) throw new ApiError(404, 'Quotation not found');

  const settings = await settingsRepository.get();

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${quotation.quotationNumber}.pdf"`);
  doc.pipe(res);

  renderQuotationPdf(doc, { company: settings, customer: quotation.customer, quotation });

  doc.end();
});

/** Renders a Quotation/Memo/GST PDF into an in-memory Buffer (for attaching to WhatsApp, email, etc). */
async function renderDocumentBuffer({ documentType, quotation, billId }) {
  const settings = await settingsRepository.get();
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  if (documentType === 'Quotation') {
    renderQuotationPdf(doc, { company: settings, customer: quotation.customer, quotation });
    doc.end();
    return { buffer: await done, filename: `${quotation.quotationNumber}.pdf` };
  }

  const bill = await billRepository.findById(Number(billId));
  if (!bill) throw new ApiError(404, 'Bill not found');
  const snapshot = JSON.parse(bill.snapshotJson);
  const context = {
    company: settings,
    customer: billCustomerOf(bill),
    order: bill.order,
    quotation: snapshot.quotation,
    bill,
    paymentInfo: snapshot.paymentInfo,
    customFields: snapshot.customFields || {},
  };
  if (bill.billType === 'GST') renderGstBillPdf(doc, context);
  else renderMemoBillPdf(doc, context);
  doc.end();
  return { buffer: await done, filename: `${bill.billNumber}.pdf` };
}

module.exports = {
  list, listAll, getOne, create, createStandalone, update, remove,
  downloadPdf, downloadQuotationPdf, renderDocumentBuffer,
};
