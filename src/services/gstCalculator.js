const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Computes line-level and quotation-level totals.
 *
 * items: [{ quantity, unitPrice, discountPercent, gstPercent }]
 * quotationType: 'GST' | 'NonGST'
 * isInterState: true when customer.state !== company.state (drives IGST vs CGST+SGST split)
 */
function calculateTotals({ items, quotationType, isInterState }) {
  let subtotal = 0;
  let discountAmount = 0;
  let gstAmount = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  const computedItems = items.map((item) => {
    const lineBase = item.quantity * item.unitPrice;
    const lineDiscount = lineBase * ((item.discountPercent || 0) / 100);
    const taxableValue = lineBase - lineDiscount;

    let lineGst = 0;
    let lineCgst = 0;
    let lineSgst = 0;
    let lineIgst = 0;

    if (quotationType === 'GST') {
      const gstPercent = item.gstPercent || 0;
      lineGst = taxableValue * (gstPercent / 100);
      if (isInterState) {
        lineIgst = lineGst;
      } else {
        lineCgst = lineGst / 2;
        lineSgst = lineGst / 2;
      }
    }

    const amount = quotationType === 'GST' ? taxableValue + lineGst : taxableValue;

    subtotal += lineBase;
    discountAmount += lineDiscount;
    gstAmount += lineGst;
    cgst += lineCgst;
    sgst += lineSgst;
    igst += lineIgst;

    return {
      ...item,
      taxableValue: round2(taxableValue),
      lineGst: round2(lineGst),
      amount: round2(amount),
    };
  });

  const total =
    quotationType === 'GST'
      ? subtotal - discountAmount + gstAmount
      : subtotal - discountAmount;

  return {
    items: computedItems,
    subtotal: round2(subtotal),
    discountAmount: round2(discountAmount),
    gstAmount: round2(gstAmount),
    cgst: round2(cgst),
    sgst: round2(sgst),
    igst: round2(igst),
    total: round2(total),
  };
}

/**
 * Groups stored line items (quantity/unitPrice/discountPercent/gstPercent) by their individual GST
 * rate, so a bill/quotation can show "GST 5%: ₹X" and "GST 18%: ₹Y" as separate lines (matching the
 * paper quotation book) instead of one flat blended tax figure — needed because some line items
 * (e.g. stitching, installation) are commonly quoted GST-exempt (0%) alongside items that do carry GST.
 */
function groupByGstRate(items) {
  const groups = new Map();
  items.forEach((item) => {
    const rate = item.gstPercent || 0;
    if (rate <= 0) return;
    const taxableValue = item.quantity * item.unitPrice * (1 - (item.discountPercent || 0) / 100);
    const taxAmount = taxableValue * (rate / 100);
    const existing = groups.get(rate) || { rate, taxableValue: 0, taxAmount: 0 };
    existing.taxableValue += taxableValue;
    existing.taxAmount += taxAmount;
    groups.set(rate, existing);
  });

  return Array.from(groups.values())
    .sort((a, b) => a.rate - b.rate)
    .map((g) => ({ ...g, taxableValue: round2(g.taxableValue), taxAmount: round2(g.taxAmount) }));
}

module.exports = { calculateTotals, groupByGstRate, round2 };
