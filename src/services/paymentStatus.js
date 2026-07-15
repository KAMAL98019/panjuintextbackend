const { round2 } = require('./gstCalculator');

/**
 * Given a quotation total and the list of payments recorded against its order,
 * computes paid/pending amounts and a human payment-status label.
 */
function computePaymentStatus(quotationTotal, payments) {
  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  const pending = round2(Math.max(quotationTotal - paid, 0));

  let status = 'Pending';
  if (paid <= 0) status = 'Pending';
  else if (pending <= 0) status = 'Fully Paid';
  else status = 'Partially Paid';

  return { paid, pending, status };
}

/** Order timeline status auto-advances once the balance reaches zero. */
function nextOrderStatusAfterPayment(currentStatus, pending, paidSoFar) {
  if (pending <= 0) return 'FullyPaid';
  if (paidSoFar > 0 && currentStatus === 'Confirmed') return 'AdvancePaid';
  return currentStatus;
}

module.exports = { computePaymentStatus, nextOrderStatusAfterPayment };
