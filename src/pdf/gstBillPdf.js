const path = require('path');
const { formatDate } = require('./helpers');
const { amountToIndianWords } = require('../services/amountInWords');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const PAD_PATH = path.join(__dirname, '..', '..', 'assets', 'gst-pad-a4.png');

// The artwork is the user's real 1086x1449 Tax Invoice pad scan stretched to A4; all
// coordinates below are in A4 points, converted from pixel positions measured on the scan.
const X = (px) => (px * PAGE_W) / 1086;
const Y = (px) => (px * PAGE_H) / 1449;

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Splits an amount into the pad's "Rs." and "Ps." columns
function rsPs(n) {
  const num = Number(n || 0);
  const rs = Math.floor(num);
  const ps = Math.round((num - rs) * 100);
  return [rs.toLocaleString('en-IN'), String(ps).padStart(2, '0')];
}

/**
 * Prints a Tax Invoice onto the exact scanned "Tax Invoice Cash / Credit" pad artwork —
 * the template IS the pad; only the filled-in values are drawn on top.
 */
function renderGstBillPdf(doc, { customer, quotation, bill, customFields = {} }) {
  doc.image(PAD_PATH, 0, 0, { width: PAGE_W, height: PAGE_H });

  // Print our invoice number
  doc.fillColor('#2e3192').font('Helvetica-Bold').fontSize(10);
  const cleanNumber = (bill?.billNumber || '').replace(/^(MEMO|INV|GST)(?:-DEMO)?-/i, '');
  doc.text(cleanNumber, X(172), Y(270), { lineBreak: false });

  doc.fillColor('#000000').font('Helvetica').fontSize(9.5);
  doc.text(formatDate(bill?.generatedAt || new Date()), X(830), Y(270), { lineBreak: false });

  // Party block (left)
  const addr = String(customer?.address || '').replace(/\n/g, ', ');
  doc.text(customer?.name || '', X(85), Y(325), { width: X(470), lineBreak: false });
  doc.text(addr, X(35), Y(368), { width: X(520), height: Y(84), lineBreak: false });
  doc.text(customer?.mobile || '', X(205), Y(450), { width: X(345), lineBreak: false });
  doc.text(customer?.gstNumber || '', X(215), Y(497), { width: X(335), lineBreak: false });

  // Supply/transport block (right)
  doc.text(customFields.placeOfSupply || customer?.state || '', X(770), Y(325), { width: X(280), lineBreak: false });
  doc.text(customFields.modeOfTransport || '', X(770), Y(368), { width: X(280), lineBreak: false });
  doc.text(customFields.dateOfSupply ? formatDate(customFields.dateOfSupply) : '', X(770), Y(412), { width: X(280), lineBreak: false });
  doc.text(customFields.vehicleNo || '', X(770), Y(455), { width: X(280), lineBreak: false });
  doc.text(customFields.transporterName || '', X(770), Y(500), { width: X(280), lineBreak: false });

  // Items — columns measured off the pad grid (Amount split into Rs. | Ps.)
  const cols = [
    { x: 5, w: 45, align: 'center' },     // S.No
    { x: 50, w: 100, align: 'center' },   // HSN Code
    { x: 150, w: 511, align: 'left' },    // Particulars
    { x: 661, w: 98, align: 'center' },   // Qty
    { x: 759, w: 137, align: 'right' },   // Rate
    { x: 896, w: 137, align: 'right' },   // Amount Rs.
    { x: 1033, w: 46, align: 'center' },  // Ps.
  ];
  const bodyTop = Y(592);
  const bodyBottom = Y(1058);
  doc.font('Helvetica').fontSize(9).fillColor('#000000');

  let rowY = bodyTop;
  (quotation?.items || []).forEach((item, idx) => {
    const desc = item.description || '';
    const rowH = Math.max(14, doc.heightOfString(desc, { width: X(cols[2].w) - 6 }) + 5);
    if (rowY + rowH > bodyBottom) return; // single sheet, like the real pad
    const [rs, ps] = rsPs(item.taxableValue ?? item.amount);
    const cells = [String(idx + 1), item.hsnCode || '', desc, `${item.quantity ?? ''}`, money(item.unitPrice), rs, ps];
    cols.forEach((c, ci) => {
      doc.text(cells[ci], X(c.x) + 3, rowY, { width: X(c.w) - 6, align: c.align });
    });
    rowY += rowH;
  });

  // Rupees in words
  doc.font('Helvetica-Oblique').fontSize(8.5);
  doc.text(amountToIndianWords(Math.round(quotation?.total || 0)), X(180), Y(1102), { width: X(470), height: Y(70) });

  // Tax box (right): value cell x 895→1078; label rows carry the % rates
  const rows = [
    [Y(1088), quotation ? quotation.subtotal - (quotation.discountAmount || 0) : 0, true],
    [Y(1132), (quotation?.igst || 0) > 0 ? null : quotation?.cgst, false],
    [Y(1176), (quotation?.igst || 0) > 0 ? null : quotation?.sgst, false],
    [Y(1219), (quotation?.igst || 0) > 0 ? quotation?.igst : null, false],
    [Y(1263), quotation?.total, true],
  ];
  const rates = [...new Set((quotation?.items || []).map((i) => Number(i.gstPercent) || 0).filter((r) => r > 0))];
  const halfRate = rates.length === 1 ? `${rates[0] / 2}` : '';
  const fullRate = rates.length === 1 ? `${rates[0]}` : '';
  const igstApplies = (quotation?.igst || 0) > 0;

  rows.forEach(([ry, value, bold]) => {
    if (value === null || value === undefined) return;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000000');
    const [rs, ps] = rsPs(value);
    doc.text(rs, X(896) + 3, ry, { width: X(137) - 6, align: 'right' });
    doc.text(ps, X(1033) + 3, ry, { width: X(46) - 6, align: 'center' });
  });
  // Percent numbers just before the printed % signs
  doc.font('Helvetica').fontSize(9);
  if (!igstApplies && halfRate) {
    doc.text(halfRate, X(790), Y(1132), { width: X(48), align: 'right' });
    doc.text(halfRate, X(790), Y(1176), { width: X(48), align: 'right' });
  }
  if (igstApplies && fullRate) doc.text(fullRate, X(790), Y(1219), { width: X(48), align: 'right' });

  doc.fillColor('#000000');
}

module.exports = { renderGstBillPdf };
