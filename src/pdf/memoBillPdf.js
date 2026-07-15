const path = require('path');
const { formatDate } = require('./helpers');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const PAD_PATH = path.join(__dirname, '..', '..', 'assets', 'memo-pad-a4.png');

// The artwork is the user's real 1086x1449 MEMO pad scan stretched to A4; all coordinates
// below are in A4 points, converted from pixel positions measured on the scan.
const X = (px) => (px * PAGE_W) / 1086;
const Y = (px) => (px * PAGE_H) / 1449;
const CREAM = '#fbf7e5'; // pad background, used to mask the preprinted serial number

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Prints a Memo onto the exact scanned MEMO pad artwork — the template IS the pad;
 * only the handwritten-in values are drawn on top.
 */
function renderMemoBillPdf(doc, { customer, quotation, bill, paymentInfo, customFields = {} }) {
  doc.image(PAD_PATH, 0, 0, { width: PAGE_W, height: PAGE_H });

  // Mask the pad's preprinted serial number, then print ours
  doc.rect(X(150), Y(248), X(200), Y(52)).fill(CREAM);
  doc.fillColor('#2e3192').font('Helvetica-Bold').fontSize(10);
  const cleanNumber = (bill?.billNumber || '').replace(/^(MEMO|INV|GST)(?:-DEMO)?-/i, '');
  doc.text(cleanNumber, X(155), Y(262), { lineBreak: false });

  doc.fillColor('#000000').font('Helvetica').fontSize(9.5);
  doc.text(formatDate(bill?.generatedAt || new Date()), X(790), Y(258), { lineBreak: false });

  // Name / Cell / Address
  const name = customFields.recipientName || customer?.name || '';
  const cell = customFields.recipientCell || customer?.mobile || '';
  const address = String(customFields.deliveryAddress || customer?.address || '').replace(/\n/g, ', ');
  doc.text(name, X(190), Y(325), { width: X(480), lineBreak: false });
  doc.text(cell, X(760), Y(325), { width: X(250), lineBreak: false });
  doc.text(address, X(210), Y(373), { width: X(800), height: Y(40), lineBreak: false });

  // Items — columns measured off the pad grid
  const cols = [
    { x: 68, w: 60, align: 'center' },   // S.No.
    { x: 132, w: 396, align: 'left' },   // Description
    { x: 533, w: 149, align: 'center' }, // Shade Code
    { x: 682, w: 74, align: 'center' },  // Qty.
    { x: 760, w: 94, align: 'right' },   // Unit Rate
    { x: 858, w: 158, align: 'right' },  // Amount
  ];
  const bodyTop = Y(465);
  const bodyBottom = Y(1055);
  doc.font('Helvetica').fontSize(9).fillColor('#000000');

  let rowY = bodyTop;
  (quotation?.items || []).forEach((item, idx) => {
    const desc = item.description || '';
    const rowH = Math.max(14, doc.heightOfString(desc, { width: X(cols[1].w) - 6 }) + 5);
    if (rowY + rowH > bodyBottom) return; // single sheet, like the real pad
    const cells = [String(idx + 1), desc, item.shadeCode || item.hsnCode || '', `${item.quantity ?? ''}`, money(item.unitPrice), money(item.amount)];
    cols.forEach((c, ci) => {
      doc.text(cells[ci], X(c.x) + 3, rowY, { width: X(c.w) - 6, align: c.align });
    });
    rowY += rowH;
  });

  // Bottom-left details
  doc.font('Helvetica').fontSize(9.5);
  if (customFields.materialsDeliveryDate) doc.text(formatDate(customFields.materialsDeliveryDate), X(330), Y(1078), { lineBreak: false });
  doc.text(customFields.jobExecutionPeriod || '', X(330), Y(1123), { lineBreak: false });
  doc.text(customFields.remarks || '', X(330), Y(1168), { width: X(290), height: Y(40) });

  // Bottom-right money block (right-aligned into the blank space after each label)
  const valX = X(830);
  const valW = X(185);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#2e3192');
  doc.text(`Rs. ${money(quotation?.total)}`, valX, Y(1078), { width: valW, align: 'right' });
  doc.fillColor('#000000').font('Helvetica').fontSize(9.5);
  doc.text(`Rs. ${money(paymentInfo?.paid)}`, valX, Y(1123), { width: valW, align: 'right' });
  doc.text(`Rs. ${money(paymentInfo?.pending)}`, valX, Y(1168), { width: valW, align: 'right' });

  doc.fillColor('#000000');
}

module.exports = { renderMemoBillPdf };
