const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const orderRepository = require('../repositories/order.repository');
const quotationRepository = require('../repositories/quotation.repository');
const notificationRepository = require('../repositories/notification.repository');
const { computePaymentStatus, syncOrderStatusForAmountChange } = require('../services/paymentStatus');

const ORDER_TIMELINE = [
  'QuotationCreated', 'Sent', 'Negotiation', 'Confirmed', 'AdvancePaid',
  'MaterialOrdered', 'WorkStarted', 'Installation', 'Completed', 'FullyPaid',
];

function withPaymentInfo(order) {
  if (!order) return order;
  const { paid, pending, status } = computePaymentStatus(order.quotation.total, order.payments);
  return { ...order, paymentInfo: { paid, pending, status } };
}

const list = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const { search, status } = req.query;

  const { rows, total } = await orderRepository.list({
    search,
    status,
    skip: (page - 1) * limit,
    take: limit,
  });

  res.json({
    success: true,
    data: rows.map(withPaymentInfo),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

const getOne = asyncHandler(async (req, res) => {
  const order = await orderRepository.findById(Number(req.params.id));
  if (!order) throw new ApiError(404, 'Order not found');
  res.json({ success: true, data: withPaymentInfo(order) });
});

const updateStatus = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!ORDER_TIMELINE.includes(status)) throw new ApiError(422, 'Invalid order status');

  const existing = await orderRepository.findById(id);
  if (!existing) throw new ApiError(404, 'Order not found');

  const order = await orderRepository.updateStatus(id, status);
  if (status !== existing.currentStatus) {
    await notificationRepository.create({
      type: 'TrackingStatusChanged',
      title: `Tracking updated: ${existing.orderNumber}`,
      message: `${existing.quotation.customer.name} moved from ${existing.currentStatus} to ${status}`,
      quotationId: existing.quotationId,
    });
  }
  res.json({ success: true, data: withPaymentInfo(order) });
});

/** Matches the "Update Tracking Status" modal: one save that updates the order's stage and the quotation's internal notes. */
const updateTracking = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status, notes } = req.body;

  const existing = await orderRepository.findById(id);
  if (!existing) throw new ApiError(404, 'Order not found');
  if (status && !ORDER_TIMELINE.includes(status)) throw new ApiError(422, 'Invalid tracking status');

  if (status && status !== existing.currentStatus) {
    await orderRepository.updateStatus(id, status);
    await notificationRepository.create({
      type: 'TrackingStatusChanged',
      title: `Tracking updated: ${existing.orderNumber}`,
      message: `${existing.quotation.customer.name} moved from ${existing.currentStatus} to ${status}`,
      quotationId: existing.quotationId,
    });
  }
  if (notes !== undefined) await quotationRepository.updateRemarks(existing.quotationId, notes);

  const order = await orderRepository.findById(id);
  res.json({ success: true, data: withPaymentInfo(order) });
});

const update = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { assignedStaff, expectedCompletion } = req.body;

  const existing = await orderRepository.findById(id);
  if (!existing) throw new ApiError(404, 'Order not found');

  const order = await orderRepository.update(id, {
    assignedStaff,
    expectedCompletion: expectedCompletion ? new Date(expectedCompletion) : existing.expectedCompletion,
  });
  res.json({ success: true, data: withPaymentInfo(order) });
});

/**
 * Post-confirmation amount correction: moves the quotation's live total up or down (logged as a
 * QuotationRevision, same trail as pre-confirmation bargaining) without touching the quotation's
 * own status. Covers both a settlement discount (writing off a remaining balance after work is
 * done) and fixing a mistaken figure back up. Reason is optional — falls back to a generic label
 * so the revision history entry still reads sensibly. Re-derives paid/pending/status against the
 * new total so the order advances to FullyPaid when the balance clears, or steps back out of
 * FullyPaid if a correction reopens a balance.
 */
const correctAmount = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const newAmount = Number(req.body.newAmount);
  const { reason, remarks } = req.body;

  const existing = await orderRepository.findById(id);
  if (!existing) throw new ApiError(404, 'Order not found');

  await quotationRepository.addRevision(existing.quotationId, {
    previousAmount: existing.quotation.total,
    newAmount,
    reason: reason || 'Amount correction',
    remarks,
    newStatus: existing.quotation.status,
  });

  let order = await orderRepository.findById(id);
  const { paid, pending } = computePaymentStatus(order.quotation.total, order.payments);
  const nextStatus = syncOrderStatusForAmountChange(order.currentStatus, pending, paid);
  if (nextStatus !== order.currentStatus) {
    order = await orderRepository.updateStatus(id, nextStatus);
  }

  res.json({ success: true, data: withPaymentInfo(order) });
});

module.exports = { list, getOne, updateStatus, updateTracking, update, correctAmount, ORDER_TIMELINE };
