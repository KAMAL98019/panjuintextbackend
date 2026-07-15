const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const paymentRepository = require('../repositories/payment.repository');
const orderRepository = require('../repositories/order.repository');
const { computePaymentStatus, nextOrderStatusAfterPayment } = require('../services/paymentStatus');

const list = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.orderId);
  const order = await orderRepository.findById(orderId);
  if (!order) throw new ApiError(404, 'Order not found');

  const payments = await paymentRepository.listByOrder(orderId);
  const { paid, pending, status } = computePaymentStatus(order.quotation.total, payments);

  res.json({ success: true, data: payments, summary: { total: order.quotation.total, paid, pending, status } });
});

/** Records a payment and auto-advances the order timeline / payment status. */
const create = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.orderId);
  const { type, amount, paymentMode, paymentDate, remarks } = req.body;

  const order = await orderRepository.findById(orderId);
  if (!order) throw new ApiError(404, 'Order not found');

  const existingPayments = await paymentRepository.listByOrder(orderId);
  const { pending: pendingBefore } = computePaymentStatus(order.quotation.total, existingPayments);
  if (amount > pendingBefore + 0.01) {
    throw new ApiError(400, `Amount exceeds pending balance of ${pendingBefore}`);
  }

  const payment = await paymentRepository.create({
    orderId,
    type,
    amount,
    paymentMode,
    paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
    remarks,
  });

  const allPayments = [...existingPayments, payment];
  const { paid, pending, status } = computePaymentStatus(order.quotation.total, allPayments);

  const nextStatus = nextOrderStatusAfterPayment(order.currentStatus, pending, paid);
  let updatedOrder = order;
  if (nextStatus !== order.currentStatus) {
    updatedOrder = await orderRepository.updateStatus(orderId, nextStatus);
  }

  res.status(201).json({
    success: true,
    data: payment,
    summary: { total: order.quotation.total, paid, pending, status },
    order: updatedOrder,
  });
});

module.exports = { list, create };
