const { round2 } = require('./gstCalculator');

/**
 * Given a quotation total and the list of payments recorded against its order,
 * computes paid/pending amounts and a human payment-status label.
 */
function computePaymentStatus(quotationTotal, payments) {
  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  const pending = round2(Math.max(quotationTotal - paid, 0));

  let status = 'Pending';
  if (pending <= 0) status = 'Fully Paid';
  else if (paid > 0) status = 'Partially Paid';
  else status = 'Pending';

  return { paid, pending, status };
}

/**
 * Order timeline status auto-advances once the balance reaches zero. Lands on 'Completed' (the
 * same terminal work stage staff would tap by hand) rather than the old separate 'FullyPaid'
 * value — the Payment Status column already shows "Fully Paid" independently (computed above),
 * so there's no information lost, and the tracking modal no longer needs a special case for a
 * payment-only status that isn't one of its selectable work stages.
 */
function nextOrderStatusAfterPayment(currentStatus, pending, paidSoFar) {
  if (pending <= 0) return 'Completed';
  if (paidSoFar > 0 && currentStatus === 'Confirmed') return 'AdvancePaid';
  return currentStatus;
}

/**
 * Amount corrections (unlike recording a payment) can move the balance back up as well as down —
 * e.g. a mistaken discount gets corrected back to the real total. If that reopens a balance on an
 * order that was auto-marked FullyPaid (the legacy value some already-existing orders still carry),
 * step it back to AdvancePaid/Confirmed so the badge stays honest. Deliberately does NOT demote a
 * plain 'Completed' status — staff can mark work Completed by hand while payment is still pending,
 * and an amount correction shouldn't second-guess that.
 */
function syncOrderStatusForAmountChange(currentStatus, pending, paid) {
  if (currentStatus === 'FullyPaid' && pending > 0) {
    return paid > 0 ? 'AdvancePaid' : 'Confirmed';
  }
  return nextOrderStatusAfterPayment(currentStatus, pending, paid);
}

module.exports = { computePaymentStatus, nextOrderStatusAfterPayment, syncOrderStatusForAmountChange };
